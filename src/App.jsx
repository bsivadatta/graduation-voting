import React, { useState, useEffect, useCallback } from 'react';
import LoginPage from './LoginPage';
import Confetti from 'react-confetti';

const superlatives = [
  {
    title: 'Most Likely to Become a Billionaire',
    nominees: [
      { name: 'Anmol', image: '/images/anmol.png' },
      { name: 'Datta', image: '/images/datta.png' },
      { name: 'Sharvani', image: '/images/sharvani.png' },
      { name: 'Vineeth', image: '/images/vineeth.png' },
    ],
  },
  {
    title: 'Most Likely to Star in a Reality Show',
    nominees: [
      { name: 'Anmol', image: '/images/anmol.png' },
      { name: 'Datta', image: '/images/datta.png' },
      { name: 'Sharvani', image: '/images/sharvani.png' },
      { name: 'Vineeth', image: '/images/vineeth.png' },
    ],
  },
];

const APP_STORAGE_KEY = 'superlativesAppState';

const getInitialState = () => {
  const savedState = localStorage.getItem(APP_STORAGE_KEY);
  if (savedState) {
    try {
      const parsed = JSON.parse(savedState);
      // Ensure all keys are present, provide defaults if not
      return {
        userType: parsed.userType || null,
        currentIndex: parsed.currentIndex || 0,
        selectedNominee: parsed.selectedNominee || null,
        showResult: typeof parsed.showResult === 'boolean' ? parsed.showResult : false,
      };
    } catch (e) {
      console.error("Error parsing saved state:", e);
      return { userType: null, currentIndex: 0, selectedNominee: null, showResult: false };
    }
  }
  return { userType: null, currentIndex: 0, selectedNominee: null, showResult: false };
};

export default function App() {
  const initialState = getInitialState();
  const [userType, setUserType] = useState(initialState.userType);
  const [currentIndex, setCurrentIndex] = useState(initialState.currentIndex);
  const [selectedNominee, setSelectedNominee] = useState(initialState.selectedNominee);
  const [showResult, setShowResult] = useState(initialState.showResult);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  // Effect to save state to localStorage
  useEffect(() => {
    const appState = {
      userType,
      currentIndex,
      selectedNominee,
      showResult,
    };
    localStorage.setItem(APP_STORAGE_KEY, JSON.stringify(appState));
  }, [userType, currentIndex, selectedNominee, showResult]);

  // Effect to listen for storage changes from other tabs
  useEffect(() => {
    const handleStorageChange = (event) => {
      if (event.key === APP_STORAGE_KEY && event.newValue) {
        try {
          const newState = JSON.parse(event.newValue);
          // Selectively update state, do not overwrite userType from other tabs
          // Use functional updates if new state depends on old, though here direct set is fine
          if (newState.currentIndex !== currentIndex) {
            setCurrentIndex(newState.currentIndex);
          }
          // Ensure selectedNominee is updated. This is important if one user votes and others should see it (if that were the design)
          // Or more relevantly, when it's reset by nextQuestion.
          if (newState.selectedNominee !== selectedNominee) {
            setSelectedNominee(newState.selectedNominee);
          }
          if (newState.showResult !== showResult) {
            setShowResult(newState.showResult);
          }
        } catch (e) {
          console.error("Error processing storage event:", e);
        }
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => {
      window.removeEventListener('storage', handleStorageChange);
    };
    // Add local states that are compared against as dependencies
  }, [currentIndex, selectedNominee, showResult]);

  useEffect(() => {
    const updateDimensions = () => {
      setDimensions({ width: window.innerWidth, height: window.innerHeight });
    };
    updateDimensions();
    window.addEventListener('resize', updateDimensions);
    return () => window.removeEventListener('resize', updateDimensions);
  }, []);

  const current = superlatives[currentIndex];

  const handleLogin = (type) => {
    setUserType(type);
    setCurrentIndex(0);
    setSelectedNominee(null);
    setShowResult(false);
  };

  const handleVote = (name) => {
    if (!showResult) {
      if (userType === 'admin') {
        setSelectedNominee(name);
      } else {
        if (!selectedNominee || selectedNominee !== name) {
          if (current && current.nominees.find(n => n.name === selectedNominee) === undefined || selectedNominee === name) {
            setSelectedNominee(name);
          }
        }
      }
    }
  };

  const getWinner = useCallback(() => {
    if (!selectedNominee || !current) return null;
    return current.nominees.find(n => n.name === selectedNominee);
  }, [selectedNominee, current]);

  const handleRevealWinner = () => {
    if (userType === 'admin' && selectedNominee) {
      setShowResult(true);
    }
  };

  const nextQuestion = () => {
    if (userType === 'admin') {
      setSelectedNominee(null);
      setShowResult(false);
      setCurrentIndex((prev) => {
        const nextIndex = prev + 1;
        return superlatives[nextIndex] ? nextIndex : prev;
      });
    }
  };

  if (!userType) {
    return <LoginPage onLogin={handleLogin} />;
  }

  if (currentIndex >= superlatives.length && superlatives.length > 0) {
     return <div className="text-xl text-center mt-10">Thanks for participating! All superlatives completed.</div>;
  }
  if (!current) { 
    return <div className="text-xl text-center mt-10">Thanks for participating! (No current superlative)</div>;
  }

  const winner = getWinner();

  return (
    <div className="max-w-xl mx-auto p-4">
      {showResult && winner && <Confetti width={dimensions.width} height={dimensions.height} recycle={false} numberOfPieces={300} />}
      <h1 className="text-2xl font-bold text-center mb-4">{current.title}</h1>
      {!showResult ? (
        <div className="grid gap-4">
          {current.nominees.map((n) => (
            <label
              key={n.name}
              className={`flex items-center gap-4 border p-4 rounded hover:shadow ${ (showResult || (userType !== 'admin' && selectedNominee && current.nominees.some(nom => nom.name === selectedNominee) ) ) ? 'cursor-not-allowed opacity-70' : 'cursor-pointer'}`}
            >
              <input
                type="radio"
                name={current.title} 
                value={n.name}
                checked={selectedNominee === n.name}
                onChange={() => handleVote(n.name)}
                disabled={showResult || (userType !== 'admin' && selectedNominee !== null && current.nominees.some(nom => nom.name === selectedNominee) && selectedNominee !== n.name )}
                className="form-radio h-5 w-5 text-blue-600"
              />
              <img src={n.image} alt={n.name} className="w-16 h-16 rounded-full object-cover" />
              <span className="text-lg font-medium">{n.name}</span>
            </label>
          ))}

          {userType === 'admin' && (
            <button
              onClick={handleRevealWinner}
              disabled={!selectedNominee} 
              className="mt-4 bg-blue-500 text-white py-2 rounded disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Reveal Winner
            </button>
          )}
          {userType !== 'admin' && (
            <p className="text-center text-gray-600 mt-4">
              {selectedNominee && current.nominees.some(nom => nom.name === selectedNominee) ? "Your vote has been cast. Waiting for Admin to reveal winner." : "Please cast your vote."}
            </p>
          )}
        </div>
      ) : (
        winner && (
          <div className="text-center">
            <h2 className="text-xl font-semibold mb-4">🏆 Winner</h2>
            <img
              src={winner.image}
              alt={winner.name}
              className="w-40 h-40 rounded-full mx-auto mb-2 object-cover shadow-lg border-4 border-yellow-400"
            />
            <div className="text-lg font-medium mb-4">{winner.name}</div>
            
            <div className="mt-6 mb-6">
              <h3 className="text-lg font-semibold text-gray-700 mb-2">Vote Tally:</h3>
              <ul className="list-none p-0 space-y-1">
                {current.nominees.map(nominee => (
                  <li key={nominee.name} className="text-gray-600">
                    {nominee.name}: <span className="font-semibold">{selectedNominee === nominee.name ? 1 : 0} vote(s)</span>
                  </li>
                ))}
              </ul>
            </div>

            {userType === 'admin' && (
              <button onClick={nextQuestion} className="mt-6 bg-green-500 text-white py-2 px-4 rounded hover:bg-green-600 transition duration-150">
                Next Superlative
              </button>
            )}
            {userType !== 'admin' && (
              <p className="text-center text-gray-600 mt-6">Waiting for Admin to proceed to the next superlative.</p>
            )}
          </div>
        )
      )}
    </div>
  );
}
