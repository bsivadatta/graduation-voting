import React, { useState } from 'react';

const superlatives = [
  {
    title: 'Most Likely to Become a Billionaire',
    nominees: [
      { name: 'Anmol', image: '/images/anmol.jpg' },
      { name: 'Datta', image: '/images/datta.jpg' },
      { name: 'Sharvani', image: '/images/sharvani.jpg' },
      { name: 'Vineeth', image: '/images/vineeth.jpg' },
    ],
  },
  {
    title: 'Most Likely to Star in a Reality Show',
    nominees: [
      { name: 'Anmol', image: '/images/anmol.jpg' },
      { name: 'Datta', image: '/images/datta.jpg' },
      { name: 'Sharvani', image: '/images/sharvani.jpg' },
      { name: 'Vineeth', image: '/images/vineeth.jpg' },
    ],
  },
];

export default function App() {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [votes, setVotes] = useState({});
  const [showResult, setShowResult] = useState(false);

  const current = superlatives[currentIndex];

  const handleVote = (name) => {
    setVotes((prev) => ({
      ...prev,
      [name]: (prev[name] || 0) + 1,
    }));
  };

  const getWinner = () => {
    const counts = current.nominees.map((n) => ({
      ...n,
      count: votes[n.name] || 0,
    }));
    return counts.sort((a, b) => b.count - a.count)[0];
  };

  const nextQuestion = () => {
    setVotes({});
    setShowResult(false);
    setCurrentIndex((prev) => prev + 1);
  };

  if (!current) return <div className="text-xl text-center mt-10">Thanks for voting!</div>;

  return (
    <div className="max-w-xl mx-auto p-4">
      <h1 className="text-2xl font-bold text-center mb-4">{current.title}</h1>
      {!showResult ? (
        <div className="grid gap-4">
          {current.nominees.map((n) => (
            <button
              key={n.name}
              onClick={() => handleVote(n.name)}
              className="flex items-center gap-4 border p-4 rounded hover:shadow"
            >
              <img src={n.image} alt={n.name} className="w-16 h-16 rounded-full object-cover" />
              <span className="text-lg font-medium">{n.name}</span>
            </button>
          ))}
          <button onClick={() => setShowResult(true)} className="mt-4 bg-blue-500 text-white py-2 rounded">
            Reveal Winner
          </button>
        </div>
      ) : (
        <div className="text-center">
          <h2 className="text-xl font-semibold mb-4">🏆 Winner</h2>
          <img
            src={getWinner().image}
            alt={getWinner().name}
            className="w-40 h-40 rounded-full mx-auto mb-2 object-cover"
          />
          <div className="text-lg font-medium">{getWinner().name}</div>
          <button onClick={nextQuestion} className="mt-6 bg-green-500 text-white py-2 px-4 rounded">
            Next Superlative
          </button>
        </div>
      )}
    </div>
  );
}
