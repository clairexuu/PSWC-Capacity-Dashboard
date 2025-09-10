'use client';

import { useEffect, useState } from 'react';
import { auth, db } from '@/lib/firebase';
import { collection, getDocs, query, orderBy, QuerySnapshot, DocumentData } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { useRouter } from 'next/navigation';

interface Patient {
  patient_id: string;
  species: string;
  wrmd_species?: string;
  age_stage: string;
  intake_date: string;
}

export default function PatientsPage() {
  const [patientsBySpecies, setPatientsBySpecies] = useState<Map<string, Patient[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [user, setUser] = useState<null | { uid: string }>(null);
  const router = useRouter();

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
    const fetchPatients = async () => {
      if (!db) return;
      const patientsInCareQuery = query(collection(db, 'patients_in_care'), orderBy('intake_date'));
      const otherPatientsQuery = query(collection(db, 'other_patients'), orderBy('intake_date'));

      const [patientsInCareSnap, otherPatientsSnap] = await Promise.all([
        getDocs(patientsInCareQuery),
        getDocs(otherPatientsQuery),
      ]);

      const extractData = (snap: QuerySnapshot<DocumentData>): Patient[] =>
        snap.docs.map((doc) => ({
          patient_id: doc.id,
          species: doc.data().species,
          wrmd_species: doc.data().wrmd_species || doc.data().species,
          age_stage: doc.data().age_stage,
          intake_date: doc.data().intake_date || 'N/A',
        }));

      const combinedPatients = [
        ...extractData(patientsInCareSnap),
        ...extractData(otherPatientsSnap),
      ];

      // Group patients by species
      const grouped = new Map<string, Patient[]>();
      combinedPatients.forEach(patient => {
        const species = patient.species;
        if (!grouped.has(species)) {
          grouped.set(species, []);
        }
        grouped.get(species)!.push(patient);
      });

      // Sort each species group by intake date
      grouped.forEach((patients) => {
        patients.sort((a, b) => {
          // Convert date strings to comparable format
          const dateA = new Date(a.intake_date);
          const dateB = new Date(b.intake_date);
          return dateA.getTime() - dateB.getTime();
        });
      });

      // Sort species alphabetically
      const sortedGrouped = new Map([...grouped.entries()].sort((a, b) => a[0].localeCompare(b[0])));

      setPatientsBySpecies(sortedGrouped);
      setLoading(false);
    };

    fetchPatients();
  }, [user]);

  const scrollToSpecies = (species: string) => {
    const element = document.getElementById(`species-${species.replace(/\s+/g, '-')}`);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
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
      <h1 className="text-2xl font-bold" style={{ margin: '24px 16px', padding: '16px 0', color: '#000000' }}>Patients in Care</h1>
      {loading ? (
        <p>Loading...</p>
      ) : (
        <>
          {/* Navigation Menu */}
          <div style={{
            padding: '16px',
            marginBottom: '20px',
            backgroundColor: '#f8f8f8',
            borderRadius: '8px',
            border: '1px solid #e5e5e5'
          }}>
            <h3 style={{ marginBottom: '12px', color: '#000', fontWeight: 'bold' }}>Quick Navigation</h3>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
              {Array.from(patientsBySpecies.keys()).map(species => (
                <button
                  key={species}
                  onClick={() => scrollToSpecies(species)}
                  style={{
                    padding: '8px 16px',
                    backgroundColor: '#B7D1B4',
                    color: '#000',
                    border: '1px solid #93b090',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '14px',
                    transition: 'background-color 0.3s'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#a7c1a4'}
                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#B7D1B4'}
                >
                  {species} ({patientsBySpecies.get(species)?.length || 0})
                </button>
              ))}
            </div>
          </div>

          {/* Species Tables */}
          <div style={{ padding: '0 16px' }}>
            {Array.from(patientsBySpecies.entries()).map(([species, patients]) => (
              <div
                key={species}
                id={`species-${species.replace(/\s+/g, '-')}`}
                style={{
                  marginBottom: 24,
                  border: '2px solid #8a8a8a',
                  borderRadius: 8,
                  backgroundColor: '#fff',
                  padding: 16,
                  scrollMarginTop: '20px'
                }}
              >
                <h2 style={{ fontSize: '1.25rem', fontWeight: 'bold', marginBottom: 12, color: '#000' }}>
                  {species}
                </h2>
              <table style={{ borderCollapse: 'collapse', width: '100%', tableLayout: 'fixed' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', background: '#B7D1B4', color: '#000', padding: '10px', width: '20%' }}>
                      Patient ID
                    </th>
                    <th style={{ textAlign: 'left', background: '#B7D1B4', color: '#000', padding: '10px', width: '35%' }}>
                      WRMD Species
                    </th>
                    <th style={{ textAlign: 'left', background: '#B7D1B4', color: '#000', padding: '10px', width: '20%' }}>
                      Age Stage
                    </th>
                    <th style={{ textAlign: 'left', background: '#B7D1B4', color: '#000', padding: '10px', width: '25%' }}>
                      Intake Date
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {patients.map((patient, i) => {
                    // Extract year and case number from patient_id (format: YY-XXX)
                    const [yearPrefix, caseNum] = patient.patient_id.split('-');
                    const year = yearPrefix ? `20${yearPrefix}` : '';
                    const wrmdUrl = `https://www.wrmd.org/continued?y=${year}&c=${caseNum}`;
                    
                    return (
                      <tr key={patient.patient_id} style={{ background: i % 2 ? '#f7f7f7' : '#ffffff' }}>
                        <td style={{ padding: '10px', borderBottom: '1px solid #eee', width: '20%' }}>{patient.patient_id}</td>
                        <td style={{ padding: '10px', borderBottom: '1px solid #eee', width: '35%' }}>
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
                        <td style={{ padding: '10px', borderBottom: '1px solid #eee', width: '20%' }}>{patient.age_stage}</td>
                        <td style={{ padding: '10px', borderBottom: '1px solid #eee', width: '25%' }}>{patient.intake_date}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}