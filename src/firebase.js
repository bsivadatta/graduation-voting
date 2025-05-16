import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
// import { getAuth } from "firebase/auth"; // We'll add this later if needed for user auth

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyCFyIMASwRlVKSyjkS-ZFVn-hgqBARwjjM",
  authDomain: "graduation-superlatives.firebaseapp.com",
  projectId: "graduation-superlatives",
  storageBucket: "graduation-superlatives.firebasestorage.app",
  messagingSenderId: "1004338898606",
  appId: "1:1004338898606:web:4327034d476bd9d642af3f"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Get a Firestore instance
const db = getFirestore(app);

// Get an Auth instance (optional for now, but useful later)
// const auth = getAuth(app);

export { db /*, auth */ };
