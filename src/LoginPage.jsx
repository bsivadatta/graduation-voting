import React, { useState, useEffect } from 'react';
// db, doc, setDoc are no longer used in this file.
// import { db } from './firebase'; 
// import { doc, setDoc } from 'firebase/firestore'; 
import { v4 as uuidv4 } from 'uuid';

// Firestore collection name - Removed as access requests are no longer created by LoginPage
// const ACCESS_REQUESTS_COLLECTION = 'accessRequests'; 

export default function LoginPage({ onLogin }) {
  const [showAdminLogin, setShowAdminLogin] = useState(false);
  // Simplified loginStep: 'selectRole', 'enterName'.
  const [loginStep, setLoginStep] = useState('selectRole');
  const [requestedUserType, setRequestedUserType] = useState(null);
  const [nameInput, setNameInput] = useState('');
  // tempRequestId and errorMessage are no longer needed.

  useEffect(() => {
    const handleKeyDown = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'g') {
        event.preventDefault();
        setShowAdminLogin((prev) => !prev);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  // The useEffect that listened to access request status is removed.
  // The useEffect that checked for 'tempRequestId' in localStorage is removed.

  const handleRoleSelect = (type) => {
    if (type === 'admin') {
      onLogin('admin', null); 
    } else {
      setRequestedUserType(type);
      setLoginStep('enterName');
    }
  };

  const handleSubmitName = async () => {
    if (!nameInput.trim()) {
      alert("Please enter your name.");
      return;
    }
    const newUserId = uuidv4();
    // Optional: Store name if needed by App.jsx or for display.
    // localStorage.setItem('userName', nameInput.trim()); 
    onLogin(requestedUserType, newUserId);
    // The component should unmount or transition after onLogin.
  };

  if (loginStep === 'enterName') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-100">
        <div className="p-8 bg-white shadow-md rounded-lg w-full max-w-md">
          <h2 className="text-2xl font-bold text-center mb-6 text-gray-700">Enter Your Name</h2>
          <p className="text-center text-gray-600 mb-4">You selected: <span className="font-semibold">{requestedUserType}</span></p>
          <input
            type="text"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            placeholder="Your Name"
            className="w-full px-4 py-2 border border-gray-300 rounded-lg mb-6 focus:ring-blue-500 focus:border-blue-500"
          />
          <button
            onClick={handleSubmitName}
            className="w-full bg-indigo-500 hover:bg-indigo-600 text-white font-semibold py-3 px-6 rounded-lg text-lg transition duration-150"
          >
            Login
          </button>
          <button
            onClick={() => setLoginStep('selectRole')}
            className="w-full mt-3 text-sm text-gray-600 hover:text-gray-800"
          >
            Back to Role Selection
          </button>
        </div>
      </div>
    );
  }

  // The 'waitingApproval', 'denied', and 'error' (related to approval) views are removed.
  // A general error state could be added if direct login itself can have user-facing errors
  // not handled by alerts, but that's outside the scope of removing admin approval.

  // Default: selectRole step
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-100">
      <div className="p-8 bg-white shadow-md rounded-lg">
        <h1 className="text-3xl font-bold text-center mb-8 text-gray-700">Welcome to Graduation Superlatives!</h1>
        <p className="text-center text-gray-600 mb-10">Please select your role to continue:</p>
        <div className="space-y-4">
          {showAdminLogin && (
            <button
              onClick={() => handleRoleSelect('admin')}
              className="w-full bg-red-500 hover:bg-red-600 text-white font-semibold py-3 px-6 rounded-lg text-lg transition duration-150 ease-in-out transform hover:scale-105"
            >
              Admin User
            </button>
          )}
          <button
            onClick={() => handleRoleSelect('graduating')}
            className="w-full bg-blue-500 hover:bg-blue-600 text-white font-semibold py-3 px-6 rounded-lg text-lg transition duration-150 ease-in-out transform hover:scale-105"
          >
            Graduating User
          </button>
          <button
            onClick={() => handleRoleSelect('guest')}
            className="w-full bg-green-500 hover:bg-green-600 text-white font-semibold py-3 px-6 rounded-lg text-lg transition duration-150 ease-in-out transform hover:scale-105"
          >
            Guest User
          </button>
        </div>
      </div>
    </div>
  );
} 