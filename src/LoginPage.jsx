import React, { useState, useEffect } from 'react';

export default function LoginPage({ onLogin }) {
  const [showAdminLogin, setShowAdminLogin] = useState(false);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'g') {
        event.preventDefault(); // Prevent default browser action for Ctrl+G (e.g., find)
        setShowAdminLogin((prev) => !prev);
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []); // Empty dependency array means this effect runs once on mount and cleanup on unmount

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-100">
      <div className="p-8 bg-white shadow-md rounded-lg">
        <h1 className="text-3xl font-bold text-center mb-8 text-gray-700">Welcome to Graduation Superlatives!</h1>
        <p className="text-center text-gray-600 mb-10">Please select your role to continue:</p>
        <div className="space-y-4">
          {showAdminLogin && (
            <button
              onClick={() => onLogin('admin')}
              className="w-full bg-red-500 hover:bg-red-600 text-white font-semibold py-3 px-6 rounded-lg text-lg transition duration-150 ease-in-out transform hover:scale-105"
            >
              Admin User
            </button>
          )}
          <button
            onClick={() => onLogin('graduating')}
            className="w-full bg-blue-500 hover:bg-blue-600 text-white font-semibold py-3 px-6 rounded-lg text-lg transition duration-150 ease-in-out transform hover:scale-105"
          >
            Graduating User
          </button>
          <button
            onClick={() => onLogin('guest')}
            className="w-full bg-green-500 hover:bg-green-600 text-white font-semibold py-3 px-6 rounded-lg text-lg transition duration-150 ease-in-out transform hover:scale-105"
          >
            Guest User
          </button>
        </div>
      </div>
    </div>
  );
} 