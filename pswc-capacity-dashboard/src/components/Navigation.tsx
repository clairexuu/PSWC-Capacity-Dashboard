'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { auth, db } from '@/lib/firebase';
import { collection, onSnapshot, doc } from 'firebase/firestore';
import { onAuthStateChanged, signOut } from 'firebase/auth';

export default function Navigation() {
  const [hasFailedPatients, setHasFailedPatients] = useState(false);
  const [user, setUser] = useState<null | { uid: string }>(null);
  const [lastUpdate, setLastUpdate] = useState<{ timestamp: string; status: string } | null>(null);

  useEffect(() => {
    if (!auth || !db) return;
    
    // Set up auth listener
    const unsubAuth = onAuthStateChanged(auth, (u) => {
      setUser(u ? { uid: u.uid } : null);
    });

    // Set up real-time listener for failed_patients collection
    const unsubscribe = onSnapshot(collection(db, 'failed_patients'), (snapshot) => {
      setHasFailedPatients(!snapshot.empty);
    });
    
    // Set up listener for last update time
    const unsubLastUpdate = onSnapshot(doc(db, 'system', 'last_update'), (snapshot) => {
      if (snapshot.exists()) {
        setLastUpdate(snapshot.data() as { timestamp: string; status: string });
      }
    });

    // Cleanup listeners on unmount
    return () => {
      unsubAuth();
      unsubscribe();
      unsubLastUpdate();
    };
  }, []);


  return (
    <header style={{ background: '#f4f4f4', padding: '1rem' }}>
      <nav style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: '2rem', alignItems: 'center' }}>
          <Link href="/capacity" style={{ fontSize: '1.1rem' }}>Capacity</Link>
          <Link href="/patients" style={{ fontSize: '1.1rem' }}>Patients</Link>
          <Link href="/message" style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', fontSize: '1.1rem' }}>
            Message Board
            {hasFailedPatients && (
              <span 
                style={{
                  position: 'absolute',
                  top: '-5px',
                  right: '-10px',
                  width: '10px',
                  height: '10px',
                  backgroundColor: '#ff0000',
                  borderRadius: '50%',
                  border: '2px solid #f4f4f4'
                }}
                title="Failed patients need attention"
              />
            )}
          </Link>
        </div>
        {user && (
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            {lastUpdate && (
              <div style={{ 
                padding: '6px 12px', 
                backgroundColor: lastUpdate.status === 'success' ? '#e8f5e9' : '#ffebee',
                borderRadius: '4px',
                fontSize: '0.9rem',
                color: lastUpdate.status === 'success' ? '#2e7d32' : '#c62828',
                border: lastUpdate.status === 'success' ? '1px solid #a5d6a7' : '1px solid #ffcdd2'
              }}>
                Last updated: {lastUpdate.timestamp}
              </div>
            )}
            <button
              onClick={() => auth && signOut(auth)}
              style={{
                padding: '8px 16px',
                fontSize: '0.9rem',
                fontWeight: 600,
                backgroundColor: '#f44336',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer',
              }}
            >
              Sign out
            </button>
          </div>
        )}
      </nav>
    </header>
  );
}