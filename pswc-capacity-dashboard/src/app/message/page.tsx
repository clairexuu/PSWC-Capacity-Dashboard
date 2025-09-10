'use client';

import { useEffect, useState } from 'react';
import { collection, getDocs, orderBy, limit, query, startAfter, getCountFromServer, DocumentSnapshot } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { useRouter } from 'next/navigation';

interface FailedPatient {
  patient_id: string;
  species: string;
  wrmd_species: string;
  raw_age: string;
  intake_date: string;
  last_checked: string;
  page_number: number;
}

export default function Page() {
  interface Message {
    id: string;
    timestamp: string;
    success: boolean;
    action: string;
    page_number: number;
    patient_id: string;
    species: string;
    age_stage: string;
  }
  const [messages, setMessages] = useState<Message[]>([]);
  const [failedPatients, setFailedPatients] = useState<FailedPatient[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [lastDoc, setLastDoc] = useState<DocumentSnapshot | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [totalPages, setTotalPages] = useState(1);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [user, setUser] = useState<null | { uid: string }>(null);
  const router = useRouter();

  const pageSize = 30;

  const fetchMessages = async (startAfterDoc: DocumentSnapshot | null = null) => {
    if (!db) return [];
    // Build Firestore query for messages
    const baseQuery = query(
      collection(db, 'message'),
      orderBy('timestamp', 'desc'),
      limit(pageSize)
    );
    const msgQuery = startAfterDoc ? query(baseQuery, startAfter(startAfterDoc)) : baseQuery;

    const snap = await getDocs(msgQuery);
    const data = snap.docs.map(doc => {
      const docData = doc.data();
      return {
        id: doc.id,
        timestamp: docData.timestamp || '',
        success: docData.success || false,
        action: docData.action || '',
        page_number: docData.page_number || 0,
        patient_id: docData.patient_id || '',
        species: docData.species || '',
        age_stage: docData.age_stage || '',
      };
    });
    setLastDoc(snap.docs[snap.docs.length - 1]);
    setHasMore(data.length === pageSize);
    return data;
  };

  useEffect(() => {
    if (!auth) return;
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u ? { uid: u.uid } : null);
      setCheckingAuth(false);
      if (!u) {
        router.push('/login');
      }
    });
    return () => unsub();
  }, [router]);

  useEffect(() => {
    if (!user || !db) return;
    // Fetch failed patients
    const fetchFailedPatients = async () => {
      if (!db) return;
      const failedPatientsQuery = query(collection(db, 'failed_patients'), orderBy('intake_date', 'desc'));
      const failedSnap = await getDocs(failedPatientsQuery);
      const failedData = failedSnap.docs.map(doc => ({
        patient_id: doc.id,
        species: doc.data().species || '',
        wrmd_species: doc.data().wrmd_species || '',
        raw_age: doc.data().raw_age || '',
        intake_date: doc.data().intake_date || '',
        last_checked: doc.data().last_checked ? doc.data().last_checked.replace(' UTC-7', '') : '',
        page_number: doc.data().page_number || doc.data().page || 0
      }));
      setFailedPatients(failedData);
    };

    // Fetch messages
    fetchMessages().then(data => {
      setMessages(data);
      setLoading(false);
    });
    
    fetchFailedPatients();
    
    const fetchTotalCount = async () => {
      if (!db) return;
      const coll = collection(db, 'message');
      const snapshot = await getCountFromServer(coll);
      const totalCount = snapshot.data().count;
      setTotalPages(Math.ceil(totalCount / pageSize));
    };
    fetchTotalCount();
  }, [user]);

  const handleNext = async () => {
    if (!hasMore || !lastDoc) return;
    const data = await fetchMessages(lastDoc);
    setMessages(data);
    setPage(prev => prev + 1);
  };

  const handlePrev = async () => {
    if (page <= 0 || !db) return;
    const allMsgs = await getDocs(query(
      collection(db, 'message'),
      orderBy('timestamp', 'desc'),
      limit((page - 1) * pageSize + pageSize)
    ));
    const docs = allMsgs.docs.slice((page - 1) * pageSize, page * pageSize);
    setMessages(docs.map(doc => {
      const docData = doc.data();
      return {
        id: doc.id,
        timestamp: docData.timestamp || '',
        success: docData.success || false,
        action: docData.action || '',
        page_number: docData.page_number || 0,
        patient_id: docData.patient_id || '',
        species: docData.species || '',
        age_stage: docData.age_stage || '',
      };
    }));
    setPage(prev => prev - 1);
    setLastDoc(allMsgs.docs[page * pageSize - 1] || null);
    setHasMore(true);
  };

  if (checkingAuth || !user || loading) {
    return (
      <div style={{ 
        padding: 24, 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        minHeight: '100vh' 
      }}>
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <div className="p-6 min-h-screen" style={{ backgroundColor: '#ffffff !important', color: '#000000 !important', minHeight: '100vh' }}>
      <h1 className="text-2xl font-bold" style={{ margin: '24px 16px', padding: '16px 0', color: '#000000' }}>Message Board</h1>
      {loading ? (
        <p style={{ color: '#000000' }}>Loading...</p>
      ) : (
        <>
          {/* Failed Patients Table */}
          {failedPatients.length > 0 && (
            <div
              style={{
                overflowX: 'auto',
                border: '2px solid #ff6b6b',
                borderRadius: 8,
                backgroundColor: '#ffffff',
                padding: 16,
                marginBottom: 24,
                color: '#000000'
              }}
            >
              <h2 style={{ fontSize: '1.25rem', fontWeight: 'bold', marginBottom: 12, color: '#000000' }}>
                Failed Patients (Invalid Age Stage)
              </h2>
              <table style={{ borderCollapse: 'collapse', width: '100%', tableLayout: 'fixed' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', background: '#ffcccb', color: '#000', padding: '10px', width: '20%' }}>Patient ID</th>
                    <th style={{ textAlign: 'left', background: '#ffcccb', color: '#000', padding: '10px', width: '20%' }}>Species</th>
                    <th style={{ textAlign: 'left', background: '#ffcccb', color: '#000', padding: '10px', width: '20%' }}>WRMD Species</th>
                    <th style={{ textAlign: 'left', background: '#ffcccb', color: '#000', padding: '10px', width: '20%' }}>Invalid Age</th>
                    <th style={{ textAlign: 'left', background: '#ffcccb', color: '#000', padding: '10px', width: '20%' }}>Intake Date</th>
                  </tr>
                </thead>
                <tbody>
                  {failedPatients.map((patient, i) => {
                    // Extract year and case number from patient_id (format: YY-XXX)
                    const [yearPrefix, caseNum] = patient.patient_id.split('-');
                    const year = yearPrefix ? `20${yearPrefix}` : '';
                    const wrmdUrl = `https://www.wrmd.org/continued?y=${year}&c=${caseNum}`;
                    
                    return (
                      <tr key={patient.patient_id} style={{ background: i % 2 ? '#fff5f5' : '#ffffff', color: '#000000' }}>
                        <td style={{ padding: '10px', borderBottom: '1px solid #eee', color: '#000000' }}>{patient.patient_id}</td>
                        <td style={{ padding: '10px', borderBottom: '1px solid #eee', color: '#000000' }}>{patient.species || 'N/A'}</td>
                        <td style={{ padding: '10px', borderBottom: '1px solid #eee' }}>
                          <a 
                            href={wrmdUrl} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            style={{ 
                              color: '#0070f3', 
                              textDecoration: 'underline',
                              cursor: 'pointer'
                            }}
                          >
                            {patient.wrmd_species}
                          </a>
                        </td>
                        <td style={{ padding: '10px', borderBottom: '1px solid #eee', color: '#cc0000', fontWeight: 'bold' }}>{patient.raw_age || 'N/A'}</td>
                        <td style={{ padding: '10px', borderBottom: '1px solid #eee', color: '#000000' }}>{patient.intake_date}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Messages Table */}
          <div
            style={{
              overflowX: 'auto',
              border: '1px solid #e5e5e5',
              borderRadius: 8,
              backgroundColor: '#ffffff',
              padding: 16,
              color: '#000000'
            }}
          >
            <h2 style={{ fontSize: '1.25rem', fontWeight: 'bold', marginBottom: 12, color: '#000000' }}>
              Recent Activity
            </h2>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', background: '#B7D1B4', color: '#000', padding: '10px', position: 'sticky', top: 0 }}>Timestamp</th>
                <th style={{ textAlign: 'left', background: '#B7D1B4', color: '#000', padding: '10px', position: 'sticky', top: 0 }}>Patient ID</th>
                <th style={{ textAlign: 'left', background: '#B7D1B4', color: '#000', padding: '10px', position: 'sticky', top: 0 }}>Species</th>
                <th style={{ textAlign: 'left', background: '#B7D1B4', color: '#000', padding: '10px', position: 'sticky', top: 0 }}>Age Stage</th>
                <th style={{ textAlign: 'left', background: '#B7D1B4', color: '#000', padding: '10px', position: 'sticky', top: 0 }}>Action</th>
                <th style={{ textAlign: 'left', background: '#B7D1B4', color: '#000', padding: '10px', position: 'sticky', top: 0 }}>Success</th>
              </tr>
            </thead>
            <tbody>
              {messages.map((msg, i) => (
                <tr key={msg.id} style={{ background: i % 2 ? '#f7f7f7' : '#ffffff', color: '#000000' }}>
                  <td style={{ padding: '10px', borderBottom: '1px solid #eee', color: '#000000' }}>
                    {msg.timestamp ? msg.timestamp.replace(' UTC-7', '') : 'N/A'}
                  </td>
                  <td style={{ padding: '10px', borderBottom: '1px solid #eee', color: '#000000' }}>{msg.patient_id ?? 'N/A'}</td>
                  <td style={{ padding: '10px', borderBottom: '1px solid #eee', color: '#000000' }}>{msg.species ?? 'N/A'}</td>
                  <td style={{ padding: '10px', borderBottom: '1px solid #eee', color: '#000000' }}>{msg.age_stage ?? 'N/A'}</td>
                  <td style={{ padding: '10px', borderBottom: '1px solid #eee', color: '#000000' }}>{msg.action ?? 'N/A'}</td>
                  <td style={{ padding: '10px', borderBottom: '1px solid #eee', color: '#000000' }}>{msg.success ? '✅' : '❌'}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ marginTop: 24, display: 'flex', justifyContent: 'space-between', backgroundColor: '#ffffff', color: '#000000' }}>
            <button
              onClick={handlePrev}
              disabled={page <= 0}
              style={{ 
                color: '#000000', 
                fontSize: '16px',
                backgroundColor: page <= 0 ? '#e0e0e0' : '#B7D1B4',
                padding: '8px 16px',
                border: '1px solid #93b090',
                borderRadius: '4px',
                cursor: page <= 0 ? 'not-allowed' : 'pointer'
              }}
            >
              Previous
            </button>
            <div>
              {Array.from({ length: totalPages }, (_, i) => (
                <button
                  key={i}
                  onClick={async () => {
                    if (!db) return;
                    const offset = i * pageSize;
                    const snap = await getDocs(query(collection(db, 'message'), orderBy('timestamp', 'desc'), limit(offset + pageSize)));
                    const docs = snap.docs.slice(offset, offset + pageSize);
                    setMessages(docs.map(doc => {
                      const docData = doc.data();
                      return {
                        id: doc.id,
                        timestamp: docData.timestamp || '',
                        success: docData.success || false,
                        action: docData.action || '',
                        page_number: docData.page_number || 0,
                        patient_id: docData.patient_id || '',
                        species: docData.species || '',
                        age_stage: docData.age_stage || '',
                      };
                    }));
                    setPage(i);
                    setLastDoc(snap.docs[offset + pageSize - 1] || null);
                    setHasMore(docs.length === pageSize);
                  }}
                  style={{
                    margin: '0 4px',
                    padding: '6px 12px',
                    fontWeight: i === page ? 'bold' : 'normal',
                    color: '#000000',
                    backgroundColor: i === page ? '#B7D1B4' : '#ffffff',
                    border: '1px solid #93b090',
                    borderRadius: '4px',
                    fontSize: '16px',
                    cursor: 'pointer'
                  }}
                >
                  {i + 1}
                </button>
              ))}
            </div>
            <button
              onClick={handleNext}
              disabled={!hasMore}
              style={{ 
                color: '#000000', 
                fontSize: '16px',
                backgroundColor: !hasMore ? '#e0e0e0' : '#B7D1B4',
                padding: '8px 16px',
                border: '1px solid #93b090',
                borderRadius: '4px',
                cursor: !hasMore ? 'not-allowed' : 'pointer'
              }}
            >
              Next
            </button>
          </div>
          </div>
        </>
      )}
    </div>
  );
}