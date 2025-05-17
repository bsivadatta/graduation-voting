import React, { useState, useEffect, useCallback } from 'react';
import LoginPage from './LoginPage';
import Confetti from 'react-confetti';
import { db, auth } from './firebase';
import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  setDoc,
  addDoc,
  updateDoc,
  query,
  where,
  orderBy,
  serverTimestamp,
  deleteDoc,
  writeBatch,
  deleteField,
} from 'firebase/firestore';
import { v4 as uuidv4 } from 'uuid'; // For generating unique user IDs
import { signInAnonymously, onAuthStateChanged } from "firebase/auth";

// localStorage keys
const USER_ID_STORAGE_KEY = 'superlativesUserId';
const USER_TYPE_STORAGE_KEY = 'superlativesUserType';

// Firestore collection names and document IDs (moved back here)
const GLOBAL_STATE_COLLECTION = 'globalState';
const CURRENT_STATE_DOC = 'currentState';
const SUPERLATIVES_COLLECTION = 'superlatives';
const VOTES_COLLECTION = 'votes';

export default function App() {
  // User-specific state (local to tab, persisted in localStorage)
  const [userType, setUserType] = useState(() => localStorage.getItem(USER_TYPE_STORAGE_KEY) || null);
  const [userId, setUserId] = useState(() => localStorage.getItem(USER_ID_STORAGE_KEY) || null);

  // Ref to track if sound has played for revealed results
  const soundPlayedForSuperlative = React.useRef({}); // { [superlativeId]: boolean }

  // Global game state (synced from Firestore)
  const [superlativesList, setSuperlativesList] = useState([]);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [isResultShown, setIsResultShown] = useState(false);
  const [allSuperlativesCompleted, setAllSuperlativesCompleted] = useState(false);
  const [isSessionStarted, setIsSessionStarted] = useState(false); // New state for session status
  const [qrCodeTargetUrl, setQrCodeTargetUrl] = useState(() => window.location.origin); // New state for QR code URL
  
  // Loading states
  const [isLoadingSuperlatives, setIsLoadingSuperlatives] = useState(true);
  const [isLoadingAppState, setIsLoadingAppState] = useState(true);
  const [isLoadingFinalSummary, setIsLoadingFinalSummary] = useState(false);

  // Voting-related state
  const [localSelectedNominee, setLocalSelectedNominee] = useState(null); // User's selection in this tab
  const [nomineeVoteStats, setNomineeVoteStats] = useState({}); // { nomineeName: { score: X, graduatingVotes: Y, firstVoteTimestamp: Z } }
  const [totalRawVotesCount, setTotalRawVotesCount] = useState(0); // New state for raw vote count for admin live view
  const [isVoting, setIsVoting] = useState(false); // To prevent rapid/double voting

  // UI state
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [finalSummaryData, setFinalSummaryData] = useState(null);
  const [adminQrUrlInput, setAdminQrUrlInput] = useState(''); // Local input for admin to change QR URL
  const [shuffledNominees, setShuffledNominees] = useState([]);
  const [adminGoToQuestionInput, setAdminGoToQuestionInput] = useState(''); // New state for admin direct question input

  // Persist userType and userId in localStorage
  useEffect(() => {
    if (userType) {
      localStorage.setItem(USER_TYPE_STORAGE_KEY, userType);
    } else {
      localStorage.removeItem(USER_TYPE_STORAGE_KEY);
    }
  }, [userType]);

  useEffect(() => {
    if (userId) {
      localStorage.setItem(USER_ID_STORAGE_KEY, userId);
    } else {
      localStorage.removeItem(USER_ID_STORAGE_KEY);
    }
  }, [userId]);

  // Fetch superlatives once on mount
  useEffect(() => {
    const fetchSuperlatives = async () => {
      setIsLoadingSuperlatives(true);
      try {
        const q = query(collection(db, SUPERLATIVES_COLLECTION), orderBy('order', 'asc'));
        const querySnapshot = await getDocs(q);
        const fetchedSuperlatives = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setSuperlativesList(fetchedSuperlatives);
      } catch (error) {
        console.error("Error fetching superlatives:", error);
      }
      setIsLoadingSuperlatives(false);
    };
    fetchSuperlatives();
  }, []);

  // Subscribe to global app state (currentQuestionIndex, isResultShown, allSuperlativesCompleted)
  useEffect(() => {
    setIsLoadingAppState(true);
    const appStateDocRef = doc(db, GLOBAL_STATE_COLLECTION, CURRENT_STATE_DOC);
    const unsubscribe = onSnapshot(appStateDocRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setIsSessionStarted(data.isSessionStarted === undefined ? false : data.isSessionStarted); // New
        setQrCodeTargetUrl(data.qrCodeTargetUrl || window.location.origin);
        setAdminQrUrlInput(data.qrCodeTargetUrl || window.location.origin); // Initialize admin input
        setCurrentQuestionIndex(data.currentQuestionIndex || 0);
        setIsResultShown(data.isResultShown || false);
        setAllSuperlativesCompleted(data.allSuperlativesCompleted || false);
        if (!data.isResultShown && !data.allSuperlativesCompleted && data.isSessionStarted) { // Check isSessionStarted
            setLocalSelectedNominee(null);
        }
      } else {
        // Initialize app state if it doesn't exist (e.g., first run)
        setDoc(appStateDocRef, { 
            isSessionStarted: false, // New
            qrCodeTargetUrl: window.location.origin, 
            currentQuestionIndex: 0, 
            isResultShown: false, 
            allSuperlativesCompleted: false 
        });
      }
      setIsLoadingAppState(false);
    }, (error) => {
      console.error("Error subscribing to app state:", error);
      setIsLoadingAppState(false);
    });
    return () => unsubscribe();
  }, []);
  
  const currentSuperlative = superlativesList[currentQuestionIndex];

  // Effect to shuffle nominees when currentSuperlative changes
  useEffect(() => {
    if (currentSuperlative && currentSuperlative.nominees && Array.isArray(currentSuperlative.nominees)) {
      const newArray = [...currentSuperlative.nominees];
      // Fisher-Yates shuffle
      for (let i = newArray.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
      }
      setShuffledNominees(newArray);
    } else {
      setShuffledNominees([]);
    }
  }, [currentSuperlative]);

  // Subscribe to votes for the current superlative
  useEffect(() => {
    if (!currentSuperlative?.id) {
      setNomineeVoteStats({}); // Clear stats if no current superlative
      setTotalRawVotesCount(0); // Clear raw count as well
      return;
    }

    // Order by timestamp to process votes chronologically for firstVoteTimestamp
    const q = query(collection(db, VOTES_COLLECTION), where('superlativeId', '==', currentSuperlative.id), orderBy('timestamp', 'asc'));
    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const newNomineeStats = {};
      currentSuperlative.nominees.forEach(n => {
        newNomineeStats[n.name] = { score: 0, graduatingVotes: 0, firstVoteTimestamp: null };
      });

      setTotalRawVotesCount(querySnapshot.size);

      querySnapshot.forEach((doc) => {
        const vote = doc.data();
        const nomineeName = vote.nomineeName;

        if (newNomineeStats[nomineeName] !== undefined) {
          newNomineeStats[nomineeName].score += 1; // All votes have a weight of 1

          if (vote.userType === 'graduating') {
            newNomineeStats[nomineeName].graduatingVotes += 1;
          }

          // Set firstVoteTimestamp if it's the first vote for this nominee
          // Firestore timestamps can be null if serverTimestamp() is used and not yet resolved
          // Or they can be Firestore Timestamp objects.
          if (!newNomineeStats[nomineeName].firstVoteTimestamp && vote.timestamp) {
             newNomineeStats[nomineeName].firstVoteTimestamp = vote.timestamp.toDate ? vote.timestamp.toDate() : new Date(vote.timestamp);
          }
        }
      });
      setNomineeVoteStats(newNomineeStats);
      
      // Update localSelectedNominee if this user has already voted on this question
      const userVoteDoc = querySnapshot.docs.find(d => d.data().userId === userId);
      if (userVoteDoc) {
        setLocalSelectedNominee(userVoteDoc.data().nomineeName);
      } else {
        // If the user's vote is not found (e.g., after a reset or if they haven't voted on this one yet)
        // and the results are not shown, ensure localSelectedNominee is clear for this question.
        // This handles the case where a user moves to a new question where they haven't voted.
        if(!isResultShown) {
            setLocalSelectedNominee(null);
        }
      }

    }, (error) => {
      console.error("Error subscribing to votes:", error);
    });

    return () => unsubscribe();
  }, [currentSuperlative?.id, userId, currentSuperlative?.nominees, isResultShown]); // Added isResultShown to dependencies


  // Window dimensions for Confetti
  useEffect(() => {
    const updateDimensions = () => setDimensions({ width: window.innerWidth, height: window.innerHeight });
    updateDimensions();
    window.addEventListener('resize', updateDimensions);
    return () => window.removeEventListener('resize', updateDimensions);
  }, []);

  const handleLogin = (type, approvedId) => {
    setUserType(type);
    if (type === 'admin') {
      // Admin logs in directly, generate their ID if it doesn't exist or is new session
      if (!userId) { // Check if userId already exists from a previous session for admin
      setUserId(uuidv4());
      }
    } else {
      // For guest/graduating, userId is pre-approved and passed in
      setUserId(approvedId);
    }
    // Global app state handled by Firestore, no client-side reset needed here beyond user identification.
  };
  
  const handleLogout = () => {
    setUserType(null);
    // Optionally, clear userId too if you want a fresh ID on next login
    // localStorage.removeItem(USER_ID_STORAGE_KEY);
    // setUserId(null);
  };


  const handleVote = async (nomineeName) => {
    if (!userId || !currentSuperlative?.id || isResultShown || isVoting || allSuperlativesCompleted || !isSessionStarted) return; // Check !isSessionStarted

    setIsVoting(true);
    setLocalSelectedNominee(nomineeName); // Optimistic UI update

    const voteDocId = `${currentSuperlative.id}_${userId}`; // Unique ID for a user's vote on a superlative
    const voteDocRef = doc(db, VOTES_COLLECTION, voteDocId);

    try {
      await setDoc(voteDocRef, {
        superlativeId: currentSuperlative.id,
        nomineeName: nomineeName,
        userId: userId,
        userType: userType, // Optional: store user type with vote
        timestamp: serverTimestamp(),
      });
      // console.log("Vote cast/updated successfully");
    } catch (error) {
      console.error("Error casting vote:", error);
      // Potentially revert optimistic UI update if needed
    }
    setIsVoting(false);
  };
  
  const getWinner = useCallback(() => {
    if (!currentSuperlative || Object.keys(nomineeVoteStats).length === 0) return null;

    // Create an array of nominee data objects from nomineeVoteStats
    const nomineeDataForSorting = Object.entries(nomineeVoteStats)
      .map(([name, stats]) => ({
        name,
        score: stats.score,
        graduatingVotes: stats.graduatingVotes,
        firstVoteTimestamp: stats.firstVoteTimestamp,
      }))
      .filter(n => n.score > 0); // Only consider nominees with actual votes

    if (nomineeDataForSorting.length === 0) return null;

    // Sort nominees:
    // 1. Score (descending)
    // 2. Graduating Votes (descending)
    // 3. First Vote Timestamp (ascending - earlier is better)
    nomineeDataForSorting.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      if (b.graduatingVotes !== a.graduatingVotes) {
        return b.graduatingVotes - a.graduatingVotes;
      }
      // Handle null timestamps (e.g., if a vote somehow didn't get one)
      if (!a.firstVoteTimestamp && !b.firstVoteTimestamp) return 0;
      if (!a.firstVoteTimestamp) return 1; // b comes first if a has no timestamp
      if (!b.firstVoteTimestamp) return -1; // a comes first if b has no timestamp
      return new Date(a.firstVoteTimestamp).getTime() - new Date(b.firstVoteTimestamp).getTime();
    });
    
    if (nomineeDataForSorting.length === 0) return null; // Should be caught by filter earlier, but safeguard

    const topNominee = nomineeDataForSorting[0];
    
    // Find all nominees who are tied with the top nominee based on all criteria
    const tiedWinners = nomineeDataForSorting.filter(n => 
        n.score === topNominee.score &&
        n.graduatingVotes === topNominee.graduatingVotes &&
        ( (n.firstVoteTimestamp === null && topNominee.firstVoteTimestamp === null) ||
          (n.firstVoteTimestamp && topNominee.firstVoteTimestamp && new Date(n.firstVoteTimestamp).getTime() === new Date(topNominee.firstVoteTimestamp).getTime()) )
    );

    const winnerObjects = tiedWinners.map(winner => {
      const nomineeObj = currentSuperlative.nominees.find(n => n.name === winner.name);
      return nomineeObj ? { 
        ...nomineeObj, 
        count: winner.score, // The 'count' is their total score
        isTie: tiedWinners.length > 1 
      } : null;
    }).filter(Boolean);
      
    return winnerObjects.length > 0 ? winnerObjects : null;

  }, [nomineeVoteStats, currentSuperlative]);


  const handleRevealWinner = async () => {
    if (userType === 'admin' && currentSuperlative?.id) {
      const appStateDocRef = doc(db, GLOBAL_STATE_COLLECTION, CURRENT_STATE_DOC);
      const superlativeDocRef = doc(db, SUPERLATIVES_COLLECTION, currentSuperlative.id);
      
      // Get winner data *before* setting isResultShown to true to avoid race conditions with getWinner relying on it
      const winnersArray = getWinner(); // This should ideally not depend on isResultShown for its calculation logic

      try {
        await updateDoc(appStateDocRef, { isResultShown: true });
        // Store the revealed winner data on the superlative document itself
        if (winnersArray && winnersArray.length > 0) {
          await updateDoc(superlativeDocRef, {
            revealedWinnerData: winnersArray.map(w => ({ name: w.name, image: w.image, count: w.count, isTie: w.isTie }))
          });
        }
        // console.log("Winner revealed and data stored.");
      } catch (error) {
        console.error("Error revealing winner or storing winner data:", error);
      }
    }
  };

  const nextQuestion = async () => {
    if (userType === 'admin' && superlativesList.length > 0) {
      const newIndex = (currentQuestionIndex + 1);
      const appStateDocRef = doc(db, GLOBAL_STATE_COLLECTION, CURRENT_STATE_DOC);
      try {
        if (newIndex < superlativesList.length) {
          await updateDoc(appStateDocRef, {
            currentQuestionIndex: newIndex,
            isResultShown: false,
            allSuperlativesCompleted: false,
          });
        } else {
          console.log("Attempted to go beyond the last superlative or already on it. Reveal winner and then proceed to summary.");
        }
      } catch (error) {
        console.error("Error moving to next question:", error);
      }
    }
  };

  const proceedToFinalSummary = async () => {
    if (userType === 'admin') {
      const appStateDocRef = doc(db, GLOBAL_STATE_COLLECTION, CURRENT_STATE_DOC);
      try {
        // Check if we are already on the last question and results are shown
        // If so, this button effectively just confirms moving to the summary.
        // Otherwise, it will mark all as completed and show summary.
        const isLastQuestion = currentQuestionIndex === superlativesList.length - 1;
        
        await updateDoc(appStateDocRef, {
          // isResultShown: true, // Results for the current/last q should be shown or decided by reveal winner
          allSuperlativesCompleted: true,
        });
        console.log("Proceeding to final summary view by admin command.");
      } catch (error) {
        console.error("Error proceeding to final summary:", error);
      }
    }
  };

  const handlePreviousQuestion = async () => {
    if (userType === 'admin' && currentQuestionIndex > 0) {
      const newIndex = currentQuestionIndex - 1;
      const appStateDocRef = doc(db, GLOBAL_STATE_COLLECTION, CURRENT_STATE_DOC);
      try {
        await updateDoc(appStateDocRef, {
          currentQuestionIndex: newIndex,
          isResultShown: false, 
          allSuperlativesCompleted: false, // Exiting summary view if going back
        });
      } catch (error) {
        console.error("Error moving to previous question:", error);
      }
    }
  };

  const handleResetCurrentResults = async () => {
    if (userType === 'admin' && currentSuperlative?.id) {
      const appStateDocRef = doc(db, GLOBAL_STATE_COLLECTION, CURRENT_STATE_DOC);
      const superlativeDocRef = doc(db, SUPERLATIVES_COLLECTION, currentSuperlative.id);
      try {
        await updateDoc(appStateDocRef, { isResultShown: false });
        // Optionally remove revealedWinnerData if results are reset
        await updateDoc(superlativeDocRef, { revealedWinnerData: deleteField() });
      } catch (error) {
        console.error("Error resetting results:", error);
      }
    }
  };

  const handleFullReset = async () => {
    if (userType !== 'admin') return;

    const confirmation = window.confirm(
      "ARE YOU SURE? This will delete all votes, clear all revealed winners, and reset the application. Users will return to the login page, and the admin will see the session start page. This action cannot be undone."
    );

    if (confirmation) {
      console.log("Initiating full application reset...");
      try {
        // 1. Delete all votes
        const votesQuery = query(collection(db, VOTES_COLLECTION));
        const voteDocsSnapshot = await getDocs(votesQuery);
        if (!voteDocsSnapshot.empty) {
          const batch = writeBatch(db);
          voteDocsSnapshot.forEach(doc => batch.delete(doc.ref));
          await batch.commit();
          console.log("All votes deleted.");
        }

        // 2. Clear revealedWinnerData from all superlatives
        const superlativesQuery = query(collection(db, SUPERLATIVES_COLLECTION));
        const superlativeDocsSnapshot = await getDocs(superlativesQuery);
        if (!superlativeDocsSnapshot.empty) {
          const superlativeBatch = writeBatch(db);
          superlativeDocsSnapshot.forEach(doc => {
            superlativeBatch.update(doc.ref, { revealedWinnerData: deleteField() });
          });
          await superlativeBatch.commit();
          console.log("Cleared revealed winner data from all superlatives.");
        }

        // 3. Reset global app state
        const appStateDocRef = doc(db, GLOBAL_STATE_COLLECTION, CURRENT_STATE_DOC);
        await setDoc(appStateDocRef, {
          isSessionStarted: false, // New
          qrCodeTargetUrl: window.location.origin, 
          currentQuestionIndex: 0,
          isResultShown: false,
          allSuperlativesCompleted: false,
        });
        console.log("Global app state reset. Session not started.");

        alert("Application has been fully reset. All users will need to log in again. Admin will see the session start page.");

      } catch (error) {
        console.error("Error during full application reset:", error);
        alert("An error occurred during the reset. Check the console.");
      }
    } else {
      console.log("Full reset cancelled by admin.");
    }
  };

  const handleGoToQuestion = async (index) => {
    if (userType === 'admin' && superlativesList.length > 0 && index >= 0 && index < superlativesList.length) {
      const appStateDocRef = doc(db, GLOBAL_STATE_COLLECTION, CURRENT_STATE_DOC);
      try {
        await updateDoc(appStateDocRef, {
          currentQuestionIndex: index,
          isResultShown: false,
          allSuperlativesCompleted: false, // Ensure we are not in summary view
        });
        console.log(`Admin navigated to question ${index + 1}`);
      } catch (error) {
        console.error("Error navigating to question:", error);
      }
    }
  };

  const handleUpdateQrUrl = async () => {
    if (userType === 'admin' && adminQrUrlInput.trim() !== '') {
      const appStateDocRef = doc(db, GLOBAL_STATE_COLLECTION, CURRENT_STATE_DOC);
      try {
        await updateDoc(appStateDocRef, { qrCodeTargetUrl: adminQrUrlInput });
        // setQrCodeTargetUrl(adminQrUrlInput); // State will update via onSnapshot
        alert("QR Code target URL updated!");
      } catch (error) {
        console.error("Error updating QR code URL:", error);
        alert("Failed to update QR Code URL.");
      }
    }
  };

  const handleStartVotingSession = async () => {
    if (userType === 'admin') {
      const appStateDocRef = doc(db, GLOBAL_STATE_COLLECTION, CURRENT_STATE_DOC);
      try {
        await updateDoc(appStateDocRef, { 
          isSessionStarted: true, // New
          currentQuestionIndex: 0, 
          isResultShown: false, 
          allSuperlativesCompleted: false,
          // qrCodeTargetUrl: window.location.origin // Ensure this is set or remains default if admin changed it
        });
        console.log("Voting session started by admin.");
      } catch (error) {
        console.error("Error starting voting session:", error);
      }
    }
  };

  // Effect to fetch and process data for the final summary
  useEffect(() => {
    if (allSuperlativesCompleted && superlativesList.length > 0) {
      const fetchAndProcessSummary = async () => {
        setIsLoadingFinalSummary(true);
        setFinalSummaryData(null); // Clear previous summary data
        try {
          // Re-fetch all superlatives to ensure we have `revealedWinnerData`
          // This assumes `revealedWinnerData` was stored by `handleRevealWinner`
          const q = query(collection(db, SUPERLATIVES_COLLECTION), orderBy('order', 'asc'));
          const querySnapshot = await getDocs(q);
          const fullSuperlativesData = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
          
          const summary = {};
          fullSuperlativesData.forEach(superlative => {
            if (superlative.revealedWinnerData && Array.isArray(superlative.revealedWinnerData)) {
              superlative.revealedWinnerData.forEach(winner => {
                if (winner.name && !winner.name.startsWith("It's a tie")) { // Only process actual winners
                  if (!summary[winner.name]) {
                    summary[winner.name] = {
                      image: winner.image || '/images/default-avatar.png', // Fallback image
                      superlativesWon: []
                    };
                  }
                  summary[winner.name].superlativesWon.push({
                      title: superlative.title,
                      id: superlative.id
                  });
                }
              });
            }
          });
          setFinalSummaryData(summary);
        } catch (error) {
          console.error("Error fetching or processing final summary data:", error);
        }
        setIsLoadingFinalSummary(false);
      };
      fetchAndProcessSummary();
    } else {
      setFinalSummaryData(null); // Clear summary if not completed
    }
  }, [allSuperlativesCompleted, superlativesList.length]); // Rerun if completion state changes or initial list length changes

  // Effect to play sound when winner is revealed
  useEffect(() => {
    const winners = getWinner(); // Calculate winners from memoized getWinner
    const superlativeId = currentSuperlative?.id;
    const defaultSoundUrl = '/sounds/default-winner-reveal.mp3'; // Default sound
    
    const customSoundUrl = currentSuperlative?.resultAnimation?.soundEffectUrl;
    // Use custom sound if it's a non-empty string after trimming, otherwise use defaultSoundUrl.
    const soundToPlay = (customSoundUrl && customSoundUrl.trim()) ? customSoundUrl.trim() : defaultSoundUrl;

    if (superlativeId && winners && winners.length > 0) {
      if (isResultShown && !soundPlayedForSuperlative.current[superlativeId]) {
        // Play sound effect
        const audio = new Audio(soundToPlay); 
        audio.play().catch(error => console.error(`Error playing sound '${soundToPlay}':`, error)); // Enhanced logging
        
        soundPlayedForSuperlative.current[superlativeId] = true;
      } else if (!isResultShown && soundPlayedForSuperlative.current[superlativeId]) {
        // Reset if results are hidden again, allowing sound to play if re-revealed
        soundPlayedForSuperlative.current[superlativeId] = false;
      }
    }
    // If navigating away from a question for which sound status was tracked, 
    // but then coming back, its state in soundPlayedForSuperlative.current will persist as intended.
    // No specific cleanup needed for a superlativeId that is no longer current, its state remains until next interaction.
  }, [isResultShown, getWinner, currentSuperlative]); // Added currentSuperlative to deps for resultAnimation check

  // --- Render Logic ---
  console.log("[DEBUG App.jsx] Render. userType:", userType);

  if (isLoadingSuperlatives || isLoadingAppState) {
    // console.log('[DEBUG] App State: isLoadingSuperlatives:', isLoadingSuperlatives, 'isLoadingAppState:', isLoadingAppState);
    return <div className="text-xl text-center mt-10">Loading Application...</div>;
  }

  // console.log('[DEBUG] App State after initial loading checks:');
  // console.log('[DEBUG] isSessionStarted:', isSessionStarted, 'userId:', userId, 'userType:', userType); 
  // console.log('[DEBUG] allSuperlativesCompleted:', allSuperlativesCompleted, 'currentQuestionIndex:', currentQuestionIndex);
  // console.log('[DEBUG] superlativesList length:', superlativesList.length, 'currentSuperlative (direct access for log):', superlativesList[currentQuestionIndex]);

  // Always show LoginPage if user is not logged in
  if (!userId || !userType) {
    return <LoginPage onLogin={handleLogin} />;
  }

  // User is logged in. Now determine view based on userType and isSessionStarted.
  return (
    <>
      <style>
        {`
          @keyframes inYourFaceAnimation {
            0% { transform: scale(0.2); opacity: 0; }    /* Start smaller */
            40% { transform: scale(2.2); opacity: 1; }  /* Pop bigger and earlier */
            60% { transform: scale(0.8); }             /* Bounce back more significantly */
            80% { transform: scale(1.1); }             /* Overshoot slightly */
            100% { transform: scale(1); opacity: 1; }   /* Settle */
          }
          .animate-in-your-face {
            animation-name: inYourFaceAnimation;
            animation-duration: 1s;
            animation-timing-function: cubic-bezier(0.34, 1.56, 0.64, 1);
          }
        `}
      </style>
      <div className="max-w-xl mx-auto p-4 relative pb-20">
        {userType === 'admin' && !isSessionStarted && (
          // Admin Start Page (Session Not Started)
          <div className="max-w-lg mx-auto p-6 text-center">
            <div className="flex justify-between items-center mb-6">
              <span className="text-sm text-gray-600">Admin: {userId.substring(0,8)}</span>
              <div>
                <button 
                  onClick={handleFullReset} 
                  title="Full Application Reset"
                  className="p-2 rounded hover:bg-gray-200 text-gray-600 hover:text-red-500 transition-colors duration-150 mr-2"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
                    <path fillRule="evenodd" d="M4.755 10.059a7.5 7.5 0 0112.548-3.364l.908-.907a.75.75 0 01.9902.055l.75.75a.75.75 0 01-.055.99l-1.5 1.5a.75.75 0 01-1.06 0l-1.5-1.5a.75.75 0 01.055-.99l.908-.907A6.002 6.002 0 005.005 10.5a6 6 0 005.793 5.995V19.5a.75.75 0 01-.75.75H8.25a.75.75 0 01-.75-.75v-2.278A7.501 7.501 0 014.755 10.059zM19.245 13.941a7.5 7.5 0 01-12.548 3.364l-.908.907a.75.75 0 01-.9902-.055l-.75-.75a.75.75 0 01.055-.99l1.5-1.5a.75.75 0 011.06 0l1.5 1.5a.75.75 0 01-.055.99l-.908.907A6.002 6.002 0 0018.995 13.5a6 6 0 00-5.793-5.995V4.5a.75.75 0 01.75-.75h2.25a.75.75 0 01.75.75v2.278a7.501 7.501 0 01-4.755 6.662z" clipRule="evenodd" />
                  </svg>
                </button>
                <button onClick={handleLogout} className="text-sm text-blue-500 hover:underline">Logout</button>
              </div>
            </div>
            <h1 className="text-3xl font-bold text-indigo-600 mb-4">Admin Dashboard</h1>
            <p className="text-gray-700 mb-6">Session has not started. Share the QR code or link below for users to join the login page. Click "Start Voting Session" when ready.</p>
            <div className="flex justify-center mb-6">
              <img 
                src={`https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qrCodeTargetUrl)}&size=250x250&format=png`} 
                alt={`QR Code for ${qrCodeTargetUrl}`} 
                className="border-4 border-gray-300 rounded shadow-lg"
              />
            </div>
            <p className="text-gray-800 font-medium mb-1">Login Page URL:</p>
            <a href={qrCodeTargetUrl} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline break-all">{qrCodeTargetUrl}</a>
            
            <div className="mt-8 pt-6 border-t border-gray-300">
              <h2 className="text-xl font-semibold text-gray-700 mb-3">Admin Controls</h2>
              <div className="mb-4">
                <label htmlFor="qrUrlInput" className="block text-sm font-medium text-gray-700 mb-1">Set Login Page Target URL (Advanced):</label>
                <input 
                  type="url" 
                  id="qrUrlInput"
                  value={adminQrUrlInput}
                  onChange={(e) => setAdminQrUrlInput(e.target.value)}
                  placeholder="Usually this app's URL"
                  className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                />
                <button 
                  onClick={handleUpdateQrUrl}
                  className="mt-2 bg-blue-500 text-white py-2 px-4 rounded hover:bg-blue-600 transition duration-150 disabled:opacity-50"
                  disabled={adminQrUrlInput.trim() === '' || adminQrUrlInput === qrCodeTargetUrl}
                >
                  Save URL
                </button>
              </div>
              <button 
                onClick={handleStartVotingSession}
                className="bg-green-600 text-white py-3 px-6 rounded-lg text-lg font-semibold hover:bg-green-700 transition duration-150 shadow-md mb-4"
              >
                Start Voting Session
              </button>
            </div>
          </div>
        )}

        {userType !== 'admin' && !isSessionStarted && (
          // Non-Admin Waiting Page (Session Not Started)
          <div className="max-w-lg mx-auto p-6 text-center">
             <div className="flex justify-between items-center mb-6">
              <span className="text-sm text-gray-600">User: {userType} ({userId.substring(0,8)})</span>
              <button onClick={handleLogout} className="text-sm text-blue-500 hover:underline">Logout</button>
            </div>
            <h1 className="text-2xl font-bold text-indigo-600 mb-4">Welcome, {userId.substring(0,8)}!</h1>
            <p className="text-gray-700 text-lg">You have successfully logged in.</p>
            <p className="text-gray-600 mt-2">Please wait for the admin to start the voting session.</p>
            <div className="mt-8">
               <svg className="animate-spin h-10 w-10 text-indigo-500 mx-auto" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
            </div>
          </div>
        )}

        {isSessionStarted && (
          // Main Application View (Session Started for Admin or Non-Admin)
          <>
            {userType === 'admin' && !allSuperlativesCompleted && superlativesList.length > 0 && (
              // This div was previously removed, now it's an empty placeholder or can be removed if truly not needed for other controls later.
              // For now, keeping it as a commented out placeholder for clarity of what was removed.
              /*
              <div className="admin-navigation-controls bg-gray-100 p-3 rounded-md shadow mb-4">
                // Content removed as per user request (dropdown and specific summary button)
              </div>
              */
              <></> // Render nothing here for now, as specific controls were moved
            )}
            {allSuperlativesCompleted ? (
              // Final Summary View
              isLoadingFinalSummary ? (
                <div className="text-xl text-center mt-10">Generating Final Results Summary...</div>
              ) : !finalSummaryData || Object.keys(finalSummaryData).length === 0 ? (
                <div className="text-xl text-center mt-10">No winners to summarize, or still processing. Thanks for participating!</div>
              ) : (
                <div className="max-w-2xl mx-auto p-4">
                  <h1 className="text-3xl font-bold text-center mb-6 text-indigo-600">🏆 Final Results Summary 🏆</h1>
                  <div className="space-y-6">
                    {Object.entries(finalSummaryData).map(([winnerName, data]) => (
                      <div key={winnerName} className="bg-white shadow-lg rounded-lg p-4 flex items-start space-x-4">
                        <img 
                          src={data.image || '/images/default-avatar.png'} 
                          alt={winnerName} 
                          className="w-20 h-20 rounded-full object-cover border-2 border-indigo-300" 
                          onError={(e) => { e.target.style.display = 'none'; }}
                        />
                        <div className="flex-1">
                          <h2 className="text-2xl font-semibold text-indigo-700">{winnerName}</h2>
                          <p className="text-md text-gray-600 mb-1">Won the following superlatives:</p>
                          <ul className="list-disc list-inside pl-2 space-y-1">
                            {data.superlativesWon.map(s => (
                              <li key={s.id} className="text-gray-700">{s.title}</li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    ))}
                  </div>
                  {userType === 'admin' && (
                    <div className="text-center mt-8 flex flex-col items-center gap-4">
                      <button 
                        onClick={handlePreviousQuestion} 
                        className="bg-gray-500 text-white py-2 px-4 rounded hover:bg-gray-600 transition duration-150 w-full sm:w-auto"
                      >
                        Back to Last Question
                      </button>
                      <button 
                        onClick={handleFullReset} 
                        title="Full Application Reset"
                        className="p-2 rounded hover:bg-gray-200 text-gray-600 hover:text-red-500 transition-colors duration-150 text-2xl mt-2 sm:mt-0 self-center"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
                          <path fillRule="evenodd" d="M4.755 10.059a7.5 7.5 0 0112.548-3.364l.908-.907a.75.75 0 01.9902.055l.75.75a.75.75 0 01-.055.99l-1.5 1.5a.75.75 0 01-1.06 0l-1.5-1.5a.75.75 0 01.055-.99l.908-.907A6.002 6.002 0 005.005 10.5a6 6 0 005.793 5.995V19.5a.75.75 0 01-.75.75H8.25a.75.75 0 01-.75-.75v-2.278A7.501 7.501 0 014.755 10.059zM19.245 13.941a7.5 7.5 0 01-12.548 3.364l-.908.907a.75.75 0 01-.9902-.055l-.75-.75a.75.75 0 01.055-.99l1.5-1.5a.75.75 0 011.06 0l1.5 1.5a.75.75 0 01-.055.99l-.908.907A6.002 6.002 0 0018.995 13.5a6 6 0 00-5.793-5.995V4.5a.75.75 0 01.75-.75h2.25a.75.75 0 01.75.75v2.278a7.501 7.501 0 01-4.755 6.662z" clipRule="evenodd" />
                        </svg>
                      </button>
                    </div>
                  )}
                </div>
              )
            ) : superlativesList.length === 0 && !isLoadingSuperlatives ? (
              <div className="text-xl text-center mt-10">
                No superlatives have been set up for this session. Please contact the admin.
              </div>
            ) : currentQuestionIndex >= superlativesList.length && superlativesList.length > 0 && !isLoadingSuperlatives ? (
              <div className="text-xl text-center mt-10">
                Thanks for participating! All superlatives completed. (Waiting for admin to show final summary)
              </div>
            ) : currentSuperlative && typeof currentSuperlative.title === 'string' && Array.isArray(currentSuperlative.nominees) ? (
              <>
                {(() => { 
                  // console.log('[DEBUG] Rendering: Main Question/Voting View. Superlative:', currentSuperlative);
                  return null; 
                })()}
                <div className="current-superlative-view">
                  {(() => {
                    const winnerDetails = getWinner();
                    if (isResultShown && winnerDetails && winnerDetails.length > 0) {
                      const isActuallyTie = winnerDetails[0].isTie;

                      // Default confetti settings
                      let resolvedConfettiProps = {
                        recycle: false,
                        numberOfPieces: isActuallyTie ? 500 : 800, 
                        width: dimensions.width,
                        height: dimensions.height,
                        // Reverted to sensible defaults for a central explosion
                        origin: { x: 0.5, y: 0.5 }, 
                        angle: 90,                  
                        spread: 360,                
                        startVelocity: 50,          
                        gravity: 0.08,             
                        scalar: 1.2,                
                        drift: 0, // Changed global default drift to 0 to reduce flicker                 
                        colors: ['#f44336', '#e91e63', '#9c27b0', '#673ab7', '#3f51b5', '#2196f3', '#03a9f4', '#00bcd4', '#009688', '#4CAF50', '#8BC34A', '#CDDC39', '#FFEB3B', '#FFC107', '#FF9800', '#FF5722', '#795548'],
                      };

                      // Helper function to draw a dollar sign
                      const drawDollarSign = (ctx) => {
                        const fontSize = 22; // Size of the dollar sign
                        ctx.font = `bold ${fontSize}px Arial`;
                        // react-confetti handles cycling through its `colors` prop for fillStyle
                        const text = '$';
                        const textMetrics = ctx.measureText(text);
                        // Center the text. react-confetti draws from the center of the piece.
                        const actualHeight = textMetrics.actualBoundingBoxAscent + textMetrics.actualBoundingBoxDescent;
                        ctx.fillText(text, -textMetrics.width / 2, actualHeight / 2);
                      };

                      // Helper function to draw a "No Drinking" sign
                      const drawNoDrinkingSign = (ctx) => {
                        const size = 20; // Overall size of the symbol
                        const lineWidth = 2.5;

                        // Red circle
                        ctx.beginPath();
                        ctx.arc(0, 0, size / 2, 0, 2 * Math.PI, false);
                        ctx.fillStyle = 'rgba(255, 0, 0, 0.8)'; // Semi-transparent red
                        ctx.fill();
                        ctx.lineWidth = lineWidth;
                        ctx.strokeStyle = 'darkred';
                        ctx.stroke();

                        // Simple Martini Glass (white or light gray)
                        ctx.beginPath();
                        // Cup (inverted triangle)
                        ctx.moveTo(-size / 5, -size / 5);
                        ctx.lineTo(size / 5, -size / 5);
                        ctx.lineTo(0, size / 8);
                        ctx.closePath();
                        // Stem
                        ctx.moveTo(0, size / 8);
                        ctx.lineTo(0, size / 3);
                        // Base
                        ctx.moveTo(-size / 6, size / 3);
                        ctx.lineTo(size / 6, size / 3);
                        
                        ctx.strokeStyle = '#FFFFFF'; // White outline for glass
                        ctx.lineWidth = lineWidth * 0.8;
                        ctx.stroke();

                        // Red slash (top-left to bottom-right)
                        ctx.beginPath();
                        ctx.moveTo(-size / 2 * 0.7, -size / 2 * 0.7);
                        ctx.lineTo(size / 2 * 0.7, size / 2 * 0.7);
                        ctx.strokeStyle = 'darkred';
                        ctx.lineWidth = lineWidth * 1.2;
                        ctx.stroke();
                      };

                      // Helper function to draw just an Airplane
                      const drawAirplane = (ctx) => {
                        const size = 22; // Overall size of the symbol
                        const lineWidth = 2;
                        ctx.lineWidth = lineWidth;
                        ctx.fillStyle = 'rgba(75, 85, 99, 0.9)'; // Darker gray for airplane
                        ctx.strokeStyle = '#333333'; 

                        ctx.beginPath();
                        // Fuselage
                        ctx.moveTo(-size * 0.4, 0);
                        ctx.lineTo(-size * 0.3, -size * 0.1);
                        ctx.lineTo(size * 0.4, -size * 0.15);
                        ctx.lineTo(size * 0.45, 0);
                        ctx.lineTo(size * 0.4, size * 0.15);
                        ctx.lineTo(-size * 0.3, size * 0.1);
                        ctx.closePath();
                        // Wing
                        ctx.moveTo(-size * 0.15, -size * 0.1);
                        ctx.lineTo(0, -size * 0.4);
                        ctx.lineTo(size * 0.1, -size * 0.35);
                        ctx.lineTo(size * 0.05, -size * 0.1);
                        // Tail wing
                        ctx.moveTo(-size * 0.35, 0);
                        ctx.lineTo(-size * 0.45, -size * 0.2);
                        ctx.lineTo(-size * 0.4, -size * 0.18);
                        ctx.fill();
                        ctx.stroke();
                      };

                      // Helper function to draw Flight Mode related symbols (Airplane, No Signal, No Wi-Fi)
                      const drawFlightModeSymbols = (ctx) => {
                        const size = 22; // Overall size of the symbol
                        const lineWidth = 2;
                        ctx.lineWidth = lineWidth;
                        ctx.fillStyle = 'rgba(100, 100, 100, 0.8)'; // Default fill for symbols
                        ctx.strokeStyle = '#333333'; // Default stroke for symbols

                        const symbolType = Math.floor(Math.random() * 3); // 0: Airplane, 1: No Signal, 2: No Wi-Fi

                        ctx.beginPath();

                        if (symbolType === 0) { // Airplane
                          ctx.fillStyle = 'rgba(75, 85, 99, 0.9)'; // Darker gray for airplane
                          // Fuselage
                          ctx.moveTo(-size * 0.4, 0);
                          ctx.lineTo(-size * 0.3, -size * 0.1);
                          ctx.lineTo(size * 0.4, -size * 0.15);
                          ctx.lineTo(size * 0.45, 0);
                          ctx.lineTo(size * 0.4, size * 0.15);
                          ctx.lineTo(-size * 0.3, size * 0.1);
                          ctx.closePath();
                          // Wing
                          ctx.moveTo(-size * 0.15, -size * 0.1);
                          ctx.lineTo(0, -size * 0.4);
                          ctx.lineTo(size * 0.1, -size * 0.35);
                          ctx.lineTo(size * 0.05, -size * 0.1);
                          // Tail wing
                          ctx.moveTo(-size * 0.35, 0);
                          ctx.lineTo(-size * 0.45, -size * 0.2);
                          ctx.lineTo(-size * 0.4, -size * 0.18);
                          ctx.fill();
                          ctx.stroke();
                        } else if (symbolType === 1) { // No Signal Bars
                          const barWidth = size / 6;
                          const barSpacing = size / 12;
                          let currentX = -size / 2 + barWidth / 2;
                          for (let i = 0; i < 4; i++) {
                            const barHeight = (size / 2) * ((i + 1) / 4);
                            ctx.rect(currentX, size / 2 - barHeight, barWidth, barHeight);
                            currentX += barWidth + barSpacing;
                          }
                          ctx.fill();
                          ctx.stroke();
                          // Red X or Slash over signal bars (optional, can be part of a general "no" symbol)
                          ctx.beginPath();
                          ctx.moveTo(-size/2.5, -size/3);
                          ctx.lineTo(size/2.5, size/3);
                          ctx.strokeStyle = 'rgba(255, 0, 0, 0.7)';
                          ctx.lineWidth = lineWidth * 1.5;
                          ctx.stroke();
                        } else { // No Wi-Fi Symbol (crossed out)
                          ctx.strokeStyle = 'rgba(0, 120, 255, 0.8)'; // Blue for Wi-Fi symbol
                          for (let i = 0; i < 3; i++) {
                            ctx.beginPath();
                            const radius = (size / 3) * (i + 1) * 0.4;
                            ctx.arc(0, size / 2.5, radius, Math.PI * 1.25, Math.PI * 1.75, false);
                            ctx.stroke();
                          }
                           // Red slash
                          ctx.beginPath();
                          ctx.moveTo(-size / 2.2, size / 2.2); // from top-left of symbol bounds
                          ctx.lineTo(size / 2.2, -size / 2.2); // to bottom-right of symbol bounds
                          ctx.strokeStyle = 'rgba(255, 0, 0, 0.7)';
                          ctx.lineWidth = lineWidth * 1.5;
                          ctx.stroke();
                        }
                      };

                      if (currentSuperlative?.resultAnimation) {
                        const customAnim = currentSuperlative.resultAnimation;
                        resolvedConfettiProps.recycle = customAnim.recycle ?? resolvedConfettiProps.recycle;
                        resolvedConfettiProps.numberOfPieces = customAnim.tieNumberOfPieces ?? customAnim.numberOfPieces ?? resolvedConfettiProps.numberOfPieces;

                        if (customAnim.confettiShape === 'dollar') {
                          resolvedConfettiProps.drawShape = drawDollarSign;
                          resolvedConfettiProps.colors = customAnim.colors ?? ['#34D399', '#10B981', '#059669', '#047857']; 
                        } else if (customAnim.confettiShape === 'noDrinkingSign') { // New shape
                          resolvedConfettiProps.drawShape = drawNoDrinkingSign;
                          // Colors for noDrinkingSign are mostly defined in the draw function, 
                          // but you can override confetti piece colors if needed (e.g. for background pieces)
                          resolvedConfettiProps.colors = customAnim.colors ?? ['#FF0000', '#FFFFFF']; // Example: Red and White pieces
                        } else if (customAnim.confettiShape === 'flightModeSymbols') { // New flight mode symbols
                          resolvedConfettiProps.drawShape = drawFlightModeSymbols;
                          // Colors for background pieces, symbols have their own internal colors mostly
                          resolvedConfettiProps.colors = customAnim.colors ?? ['#A0A0A0', '#606060', '#EAEAEA']; 
                        } else if (customAnim.confettiShape === 'flyingAirplanes') { // New: Only flying airplanes
                          resolvedConfettiProps.drawShape = drawAirplane;
                          // For flying airplanes, we typically don't want other colored confetti dots
                          // Force transparent colors for this specific shape to ensure no default confetti appears
                          resolvedConfettiProps.colors = ['rgba(0,0,0,0)']; 
                        } else if (customAnim.colors) {
                           resolvedConfettiProps.colors = customAnim.colors;
                        }
                        resolvedConfettiProps.origin = customAnim.origin ?? resolvedConfettiProps.origin;
                        resolvedConfettiProps.angle = customAnim.angle ?? resolvedConfettiProps.angle;
                        resolvedConfettiProps.spread = customAnim.spread ?? resolvedConfettiProps.spread;
                        resolvedConfettiProps.startVelocity = customAnim.startVelocity ?? resolvedConfettiProps.startVelocity;
                        resolvedConfettiProps.gravity = customAnim.gravity ?? resolvedConfettiProps.gravity; 
                        resolvedConfettiProps.scalar = customAnim.scalar ?? resolvedConfettiProps.scalar;
                        resolvedConfettiProps.drift = customAnim.drift ?? resolvedConfettiProps.drift;
                      }
                      return <Confetti {...resolvedConfettiProps} />;
                    }
                    return null;
                  })()}
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-sm text-gray-600">User: {userType} ({userId.substring(0,8)})</span>
                    <button onClick={handleLogout} className="text-sm text-blue-500 hover:underline">Logout</button>
                  </div>
                  <h1 className="text-2xl font-bold text-center mb-4">{currentSuperlative.title}</h1>
                  {!isResultShown ? (
                    // Voting Phase
                    <div className="grid gap-4">
                      {shuffledNominees.map((n) => (
                        <label
                          key={n.name}
                          className={`flex items-center gap-4 border p-4 rounded hover:shadow ${isResultShown ? 'cursor-not-allowed opacity-70' : 'cursor-pointer'} ${localSelectedNominee === n.name ? 'ring-2 ring-blue-500 border-blue-500' : 'border-gray-300'}`}
                        >
                          <input type="radio" name={currentSuperlative.id} value={n.name} checked={localSelectedNominee === n.name} onChange={() => handleVote(n.name)} disabled={isResultShown || isVoting || !isSessionStarted} className="form-radio h-5 w-5 text-blue-600"/>
                          <img 
                            src={n.image || '/images/default-avatar.png'} 
                            alt={n.name} 
                            className="w-16 h-16 rounded-full object-cover" 
                            onError={(e) => { e.target.style.display = 'none'; }}
                          />
                          <span className="text-lg font-medium">{n.name}</span>
                        </label>
                      ))}
                      {userType === 'admin' && !isResultShown && !allSuperlativesCompleted && (
                        <div className="mt-4 p-3 border rounded bg-gray-50">
                          <h3 className="text-md font-semibold text-gray-700 mb-1">Live Vote Status (Admin View):</h3>
                          {shuffledNominees.length > 0 ? (
                            <div className="text-sm text-gray-600">
                              Total Votes Cast: {totalRawVotesCount} 
                            </div>
                          ) : <p className="text-sm text-gray-500">No nominees for this superlative.</p>}
                        </div>
                      )}
                      {userType === 'admin' && !isResultShown && !allSuperlativesCompleted && (
                        <div className="mt-6 flex flex-col sm:flex-row justify-center gap-2 items-center flex-wrap">
                          {currentQuestionIndex > 0 && (
                            <button 
                              onClick={handlePreviousQuestion} 
                              className="bg-gray-500 text-white py-2 px-4 rounded hover:bg-gray-600 transition duration-150"
                            >
                              Previous Superlative
                            </button>
                          )}
                          <button
                            onClick={handleRevealWinner}
                            disabled={Object.values(nomineeVoteStats).every(stats => stats.score === 0) && !localSelectedNominee} 
                            className="bg-blue-500 text-white py-2 px-4 rounded hover:bg-blue-600 disabled:opacity-50 transition duration-150"
                          >
                            Reveal Winner
                          </button>
                          {currentQuestionIndex < superlativesList.length - 1 && (
                            <button 
                              onClick={nextQuestion} 
                              className="bg-green-500 text-white py-2 px-4 rounded hover:bg-green-600 transition duration-150"
                            >
                              Next Superlative
                            </button>
                          )}
                        </div>
                      )}
                      {userType !== 'admin' && !allSuperlativesCompleted && (<p className="text-center text-gray-600 mt-4">{localSelectedNominee ? "Your vote has been cast. Waiting for Admin to reveal winner." : "Please cast your vote."}</p>)}
                    </div>
                  ) : (
                    // Results Phase
                    getWinner() && getWinner().length > 0 && (
                      <div className="text-center">
                        <h2 className="text-xl font-semibold mb-4">🏆 {getWinner()[0].isTie ? "It's a Tie!" : `Winner: ${getWinner()[0].name}`} 🏆</h2>
                        <div className={`flex ${getWinner().length > 1 ? 'justify-around' : 'justify-center'} items-start flex-wrap`}>
                          {getWinner().map((w, index) => (
                            <div key={index} className="text-center m-2 flex flex-col items-center">
                              <img 
                                src={w.image || '/images/default-avatar.png'} 
                                alt={w.name} 
                                className={`w-40 h-40 rounded-full mb-2 object-cover shadow-lg border-4 border-yellow-400 ${isResultShown ? 'animate-in-your-face' : ''}`} 
                                onError={(e) => { e.target.style.display = 'none'; }}
                              />
                              {(getWinner()[0].isTie || getWinner().length > 1) && (<div className="text-lg font-medium mt-1">{w.name}</div>)}
                              <div className="text-md font-semibold">{w.count} vote(s)</div>
                            </div>
                          ))}
                        </div>
                        <div className="mt-6 mb-6">
                          <h3 className="text-lg font-semibold text-gray-700 mb-2">Final Vote Tally:</h3>
                          <ul className="list-none p-0 space-y-1">
                            {shuffledNominees.map(nominee => (<li key={nominee.name} className="text-gray-600">{nominee.name}: <span className="font-semibold">{nomineeVoteStats[nominee.name]?.score || 0} vote(s)</span></li>))}
                          </ul>
                        </div>
                        {userType === 'admin' && isResultShown && !allSuperlativesCompleted && (
                          <div className="mt-6 flex flex-col sm:flex-row justify-center gap-2 items-center flex-wrap">
                            {currentQuestionIndex > 0 && (<button onClick={handlePreviousQuestion} className="bg-gray-500 text-white py-2 px-4 rounded hover:bg-gray-600 transition duration-150">Previous Question</button>)}
                            <button onClick={handleResetCurrentResults} className="bg-yellow-500 text-white py-2 px-4 rounded hover:bg-yellow-600 transition duration-150">Hide Results & Re-open Voting</button>
                            {currentQuestionIndex < superlativesList.length - 1 && (<button onClick={nextQuestion} className="bg-green-500 text-white py-2 px-4 rounded hover:bg-green-600 transition duration-150">Next Superlative</button>)}
                            {currentQuestionIndex === 0 && isResultShown && (
                              <button 
                                onClick={handleFullReset} 
                                title="Full Application Reset"
                                className="p-2 rounded hover:bg-gray-200 text-gray-600 hover:text-red-500 transition-colors duration-150 ml-2"
                              >
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
                                  <path fillRule="evenodd" d="M4.755 10.059a7.5 7.5 0 0112.548-3.364l.908-.907a.75.75 0 01.9902.055l.75.75a.75.75 0 01-.055.99l-1.5 1.5a.75.75 0 01-1.06 0l-1.5-1.5a.75.75 0 01.055-.99l.908-.907A6.002 6.002 0 005.005 10.5a6 6 0 005.793 5.995V19.5a.75.75 0 01-.75.75H8.25a.75.75 0 01-.75-.75v-2.278A7.501 7.501 0 014.755 10.059zM19.245 13.941a7.5 7.5 0 01-12.548 3.364l-.908.907a.75.75 0 01-.9902-.055l-.75-.75a.75.75 0 01.055-.99l1.5-1.5a.75.75 0 011.06 0l1.5 1.5a.75.75 0 01-.055.99l-.908.907A6.002 6.002 0 0018.995 13.5a6 6 0 00-5.793-5.995V4.5a.75.75 0 01.75-.75h2.25a.75.75 0 01.75.75v2.278a7.501 7.501 0 01-4.755 6.662z" clipRule="evenodd" />
                                </svg>
                              </button>
                            )}
                          </div>
                        )}
                        {userType !== 'admin' && !allSuperlativesCompleted && currentQuestionIndex < superlativesList.length -1 && (<p className="text-center text-gray-600 mt-6">Waiting for Admin to proceed to the next superlative.</p>)}
                        {userType !== 'admin' && !allSuperlativesCompleted && currentQuestionIndex >= superlativesList.length -1 && (<p className="text-center text-gray-600 mt-6 font-semibold">All superlatives completed! Waiting for admin to show final summary.</p>)}
                      </div>
                    )
                  )}
                </div>
              </>
            ) : (
              <>
                {(() => { 
                  // console.log('[DEBUG] Fallback: currentSuperlative is falsey or invalid. superlativesList:', superlativesList, 'currentQuestionIndex:', currentQuestionIndex, 'isLoadingSuperlatives:', isLoadingSuperlatives);
                  return null; 
                })()}
                <div className="text-xl text-center mt-10">
                  Loading question, waiting for session to be fully initialized, or current question data is invalid.
                </div>
              </>
            )}
          </>
        )}

        {/* Persistent Pinned Admin Tools - Shown only if session started and not in final summary */}
        {userType === 'admin' && isSessionStarted && !allSuperlativesCompleted && (
          <div className="fixed bottom-4 left-4 bg-gray-800 bg-opacity-80 text-white p-3 rounded-lg shadow-xl z-50 flex flex-col items-start gap-3 w-auto max-w-xs">
            <div className="text-center self-start">
              <p className="text-xs mb-1">QR to Join/View:</p>
              <img 
                src={`https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qrCodeTargetUrl)}&size=80x80&format=png&bgcolor=4A5568&color=FFFFFF&qzone=1`}
                alt="QR Code" 
                className="w-20 h-20 rounded border-2 border-gray-500"
              />
            </div>
            {/* "Go to Question" Input for Admin */}
            {superlativesList.length > 0 && (
              <div className="w-full">
                <label htmlFor="admin-goto-question" className="block text-xs mb-1">Go to:</label>
                <div className="flex items-center gap-1">
                  <input 
                    type="number"
                    id="admin-goto-question"
                    value={adminGoToQuestionInput}
                    onChange={(e) => setAdminGoToQuestionInput(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                            const questionNum = parseInt(adminGoToQuestionInput);
                            if (!isNaN(questionNum) && questionNum >= 1 && questionNum <= superlativesList.length) {
                                handleGoToQuestion(questionNum - 1); // Adjust to 0-indexed
                                setAdminGoToQuestionInput(''); // Clear input after navigation
                            }
                        }
                    }}
                    min="1"
                    max={superlativesList.length}
                    className="w-full px-2 py-1 text-sm text-gray-900 rounded border-gray-300 focus:ring-indigo-500 focus:border-indigo-500"
                  />
                  <button 
                    onClick={() => {
                        const questionNum = parseInt(adminGoToQuestionInput);
                        if (!isNaN(questionNum) && questionNum >= 1 && questionNum <= superlativesList.length) {
                            handleGoToQuestion(questionNum - 1); // Adjust to 0-indexed
                            setAdminGoToQuestionInput(''); // Clear input after navigation
                        }
                    }}
                    className="bg-blue-500 hover:bg-blue-600 text-white px-3 py-1 rounded text-sm"
                    disabled={!adminGoToQuestionInput.trim() || parseInt(adminGoToQuestionInput) < 1 || parseInt(adminGoToQuestionInput) > superlativesList.length}
                  >
                    Go
                  </button>
                </div>
              </div>
            )}
             {/* Button to end session and show final summary, accessible from persistent tools */}
            {superlativesList.length > 0 && (
                <button 
                    onClick={proceedToFinalSummary} 
                    className="w-full bg-purple-600 text-white py-2 px-3 rounded hover:bg-purple-700 transition duration-150 text-sm mt-2"
                    disabled={allSuperlativesCompleted}
                >
                    End & Show Final Summary
                </button>
            )}
          </div>
        )}

        {/* Persistent Global Admin Reset Button - Visible on all admin pages post-login */} 
        {userType === 'admin' && userId && (
          <div className="fixed top-4 right-4 z-[100]"> 
            <button 
              onClick={handleFullReset} 
              title="Full Application Reset"
              className="p-3 bg-red-600 hover:bg-red-700 text-white rounded-full shadow-lg flex items-center justify-center"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
                <path fillRule="evenodd" d="M4.755 10.059a7.5 7.5 0 0112.548-3.364l.908-.907a.75.75 0 01.9902.055l.75.75a.75.75 0 01-.055.99l-1.5 1.5a.75.75 0 01-1.06 0l-1.5-1.5a.75.75 0 01.055-.99l.908-.907A6.002 6.002 0 005.005 10.5a6 6 0 005.793 5.995V19.5a.75.75 0 01-.75.75H8.25a.75.75 0 01-.75-.75v-2.278A7.501 7.501 0 014.755 10.059zM19.245 13.941a7.5 7.5 0 01-12.548 3.364l-.908.907a.75.75 0 01-.9902-.055l-.75-.75a.75.75 0 01.055-.99l1.5-1.5a.75.75 0 011.06 0l1.5 1.5a.75.75 0 01-.055.99l-.908.907A6.002 6.002 0 0018.995 13.5a6 6 0 00-5.793-5.995V4.5a.75.75 0 01.75-.75h2.25a.75.75 0 01.75.75v2.278a7.501 7.501 0 01-4.755 6.662z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
        )}
      </div>
    </>
  );
}
