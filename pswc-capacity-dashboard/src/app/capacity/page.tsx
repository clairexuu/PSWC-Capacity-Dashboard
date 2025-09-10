'use client';

import { useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, db } from '@/lib/firebase';
import { useRouter } from 'next/navigation';
import {
  collection, collectionGroup, getDocs, onSnapshot, query
} from 'firebase/firestore';

type Species = { id: string; name: string; shared_capacity: number | null };
type AgeRow = {
  id: string;
  speciesId: string;
  age: string;
  capacity: number | null;
  number_in_care: number;
};

export default function Page() {
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [user, setUser] = useState<null | { uid: string }>(null);
  const router = useRouter();

  const [speciesMap, setSpeciesMap] = useState<Record<string, Species>>({});
  const [ageRows, setAgeRows] = useState<AgeRow[]>([]);
  // const [changes, setChanges] = useState<Record<string, { delta: number; label: string }>>({});

  interface OtherPatient {
    id: string;
    patient_id: string;
    species: string;
    age_stage: string;
    intake_date: string;
    last_check?: string;
  }
  const [otherPatients, setOtherPatients] = useState<OtherPatient[]>([]);

  useEffect(() => {
    if (!auth) return;
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u ? { uid: u.uid } : null);
      setCheckingAuth(false);
      // Redirect to login if not authenticated
      if (!u) {
        router.push('/login');
      }
    });
    return () => unsub();
  }, [router]);

  useEffect(() => {
    if (!user || !db) return;

    const unsubSpecies = onSnapshot(collection(db, 'species'), (snap) => {
      const map: Record<string, Species> = {};
      snap.forEach((d) => {
        const data = d.data() as { name: string; shared_capacity: number | null };
        map[d.id] = { id: d.id, name: data.name, shared_capacity: data.shared_capacity ?? null };
      });
      setSpeciesMap(map);
    });

    const unsubAges = onSnapshot(query(collectionGroup(db, 'age')), (snap) => {
      const rows: AgeRow[] = [];
      snap.forEach((d) => {
        const data = d.data() as { age: string; capacity: number | null; number_in_care: number };
        const speciesDocRef = d.ref.parent.parent; // species/{id}
        const speciesId = speciesDocRef?.id ?? '';
        rows.push({
          id: d.id,
          speciesId,
          age: data.age,
          capacity: data.capacity ?? null,
          number_in_care: data.number_in_care ?? 0,
        });
      });
      setAgeRows(rows);
    });

    const fetchOtherPatients = async () => {
      if (!db) return;
      const snapshot = await getDocs(collection(db, 'other_patients'));
      const data = snapshot.docs.map((doc) => {
        const docData = doc.data();
        return {
          id: doc.id,
          patient_id: docData.patient_id || doc.id,
          species: docData.species || '',
          age_stage: docData.age_stage || '',
          intake_date: docData.intake_date || '',
          last_check: docData.last_check || docData.last_checked || '',
        };
      });
      setOtherPatients(data);
    };
    fetchOtherPatients();

    return () => { unsubSpecies(); unsubAges(); };
  }, [user]);

  // Compute per-row effective capacity + available, and group rows by species for display
  const groups = useMemo(() => {
    // speciesId -> rows
    const bySpecies: Record<string, AgeRow[]> = {};
    for (const r of ageRows) (bySpecies[r.speciesId] ??= []).push(r);

    return Object.keys(bySpecies)
      .sort((a, b) => (speciesMap[a]?.name || a).localeCompare(speciesMap[b]?.name || b))
      .map((sid) => {
        const sp = speciesMap[sid];
        const sharedCap = sp?.shared_capacity ?? null;

        // decorate + compute effective/available (own for independent; placeholder for shared)
        const decoratedAll = bySpecies[sid].map((r) => {
          const isShared = r.capacity == null && sharedCap != null;
          const effectiveCap = r.capacity != null ? r.capacity : sharedCap;
          const ownAvail =
            r.capacity != null
              ? Math.max((r.capacity || 0) - (r.number_in_care || 0), 0)
              : null;

          return {
            ...r,
            speciesName: sp?.name || sid,
            isShared,
            effectiveCap,
            available: ownAvail, // shared rows get overwritten below
            rowKey: `${sid}__${r.id}`,
          };
        });

        // shared pool math
        const sharedRowsAll = decoratedAll.filter((r) => r.isShared);
        const sharedUsed = sharedRowsAll.reduce((s, r) => s + (r.number_in_care || 0), 0);
        const sharedAvail = sharedCap != null ? Math.max(sharedCap - sharedUsed, 0) : null;

        const decorated = decoratedAll.map((r) =>
          r.isShared ? { ...r, available: sharedAvail } : r
        );

        // drop rows with both cap=0 and count=0
        const filtered = decorated.filter(
          (r) => !(((r.effectiveCap ?? 0) === 0) && ((r.number_in_care ?? 0) === 0))
        );

        // split => make shared block contiguous and sort ages inside each block
        const independents = filtered.filter((r) => !r.isShared).sort((a, b) => a.age.localeCompare(b.age));
        const sharedRows = filtered.filter((r) => r.isShared).sort((a, b) => a.age.localeCompare(b.age));
        const ordered = [...independents, ...sharedRows];

        // shared meta AFTER filtering/ordering
        const sharedSpan = sharedRows.length;
        const firstSharedKey = sharedSpan ? sharedRows[0].rowKey : null;

        return {
          speciesId: sid,
          speciesName: sp?.name || sid,
          rows: ordered,
          sharedMeta: {
            span: sharedSpan,
            firstKey: firstSharedKey,
            cap: sharedCap,
            avail: sharedAvail,
            startIndex: independents.length, // where the shared block begins
          },
        };
      })
      .filter((g) => g.rows.length > 0);
  }, [ageRows, speciesMap]);

  // Unused function - commented out
  /*
  function setRowChange(rowKey: string, val: string) {
    if (!val) {
      setChanges(prev => {
        const copy = { ...prev };
        delete copy[rowKey];
        return copy;
      });
      return;
    }
    const m = val.match(/(add|remove)\s*(\d+)/i);
    if (!m) return;
    const n = parseInt(m[2], 10);
    const delta = m[1].toLowerCase() === 'remove' ? -n : n;
    setChanges(prev => ({ ...prev, [rowKey]: { delta, label: val } }));
  }
  */

  // Unused function - commented out
  /*
  async function applyChange(row: { speciesId: string; id: string }, delta: number) {
    const speciesRef = doc(db, 'species', row.speciesId);
    const ageRef = doc(db, `species/${row.speciesId}/age/${row.id}`);

    await runTransaction(db, async (tx) => {
      const spSnap = await tx.get(speciesRef);
      if (!spSnap.exists()) throw new Error('Species not found');
      const sp = spSnap.data() as { shared_capacity: number | null };
      const sharedCap: number | null = sp.shared_capacity ?? null;

      const aSnap = await tx.get(ageRef);
      if (!aSnap.exists()) throw new Error('Age row not found');
      const a = aSnap.data() as { capacity: number | null; number_in_care: number };

      const effectiveCap: number | null = a.capacity != null ? a.capacity : sharedCap;
      if (effectiveCap == null) throw new Error('No capacity defined');

      // figure out capacity group members
      const sibs = await getDocs(collection(db, `species/${row.speciesId}/age`));
      let groupSum = 0;
      const clickedIndependent = a.capacity != null;
      sibs.forEach((s) => {
        const d = s.data() as { capacity: number | null; number_in_care: number };
        const sameGroup = clickedIndependent ? s.id === row.id : (d.capacity == null && sharedCap != null);
        if (sameGroup) groupSum += (d.number_in_care ?? 0);
      });

      const available = effectiveCap - groupSum;
      if (delta > 0 && delta > available) throw new Error(`Only ${available} available; cannot add ${delta}.`);
      if (delta < 0 && (a.number_in_care + delta) < 0) throw new Error('Cannot go below 0.');
      tx.update(ageRef, { number_in_care: a.number_in_care + delta });
    });
  }
  */

  // --------- UI ---------
  if (checkingAuth || !user) {
    return (
      <main style={{ 
        padding: 24, 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        minHeight: '100vh' 
      }}>
        <p>Loading...</p>
      </main>
    );
  }

  const rowStyle = (i: number) => ({
    background: i % 2 ? '#f7f7f7' : '#ffffff'
  });

  const th: React.CSSProperties = {
    textAlign: 'left',
    background: '#245a3a', color: 'white', padding: '10px', position: 'sticky', top: 0
  };

  const td: React.CSSProperties = { padding: '10px', borderBottom: '1px solid #eee' };


  // shared chip styles
  const sharedPill: React.CSSProperties = {
    marginLeft: 8,
    padding: '2px 8px',
    fontSize: 12,
    borderRadius: 999,
    background: '#E6F4EA',
    color: '#1E7A44',
    border: '1px solid #CBEBD7',
  };

  return (
    <main
      style={{
        padding: 24,
        fontFamily: 'system-ui',
        backgroundColor: '#fff',
        color: '#000',
        minHeight: '100vh',
      }}
    >
      <h1 style={{ margin: '24px 0', padding: '16px 0' }}>PSWC Capacity Dashboard</h1>

      {/* Legend for shared rows */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={sharedPill}>Shared</span>
        <span style={{ fontSize: 16, opacity: 0.75 }}>
          Ages marked &quot;Shared&quot; use the species shared capacity
        </span>
      </div>

      {/* Table wrapper */}
      <div
        style={{
          overflowX: 'auto',
          border: '1px solid #e5e5e5',
          borderRadius: 8,
          backgroundColor: '#fff',
          padding: 16,
        }}
      >
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              <th style={th}>Species</th>
              <th style={th}>Age</th>
              <th style={th}>Permit Capacity</th>
              <th style={th}>Number in Care</th>
              <th style={th}>Available Capacity</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g, gi) =>
              g.rows.map((r, idx) => {
                const speciesRowSpan = g.rows.length;

                // shared-block detection
                const inSharedBlock =
                  g.sharedMeta.span > 0 &&
                  idx >= g.sharedMeta.startIndex &&
                  idx < g.sharedMeta.startIndex + g.sharedMeta.span;

                const isSharedFirst = inSharedBlock && r.rowKey === g.sharedMeta.firstKey;

                // species separator (thicker line on first row of each species)
                const isFirstRowOfSpecies = idx === 0;

                // compose row style: zebra base + shared tint + species separator
                const baseRow = rowStyle(gi); // gives zebra background
                const rowStyles: React.CSSProperties = {
                  ...baseRow,
                  background: inSharedBlock ? '#f0faf3' : (baseRow as React.CSSProperties).background,
                  borderTop: isFirstRowOfSpecies ? '3px solid #6b7280' : '1px solid #eee', // thicker divider
                };

                return (
                  <tr key={r.rowKey} style={rowStyles}>
                    {/* Species (merged for whole species) */}
                    {idx === 0 && (
                      <td style={{ ...td, fontWeight: 600 }} rowSpan={speciesRowSpan}>
                        {g.speciesName}
                      </td>
                    )}

                    {/* Age + "Shared" pill if in shared pool */}
                    <td style={td}>
                      {r.age}
                      {inSharedBlock && (
                        <span
                          style={{
                            marginLeft: 8,
                            padding: '2px 8px',
                            fontSize: 12,
                            borderRadius: 999,
                            background: '#E6F4EA',
                            color: '#1E7A44',
                            border: '1px solid #CBEBD7',
                          }}
                          title="Uses the species shared capacity"
                        >
                          Shared
                        </span>
                      )}
                    </td>

                    {/* Permit Capacity */}
                    {inSharedBlock ? (
                      isSharedFirst ? (
                        <td style={{ ...td, verticalAlign: 'top' }} align="right" rowSpan={g.sharedMeta.span}>
                          <div style={{ fontWeight: 600 }}>{g.sharedMeta.cap ?? '—'}</div>
                          <div style={{ fontSize: 12, opacity: 0.7, marginTop: 2 }}>Shared pool</div>
                        </td>
                      ) : null
                    ) : (
                      <td style={td} align="right">{r.effectiveCap ?? '—'}</td>
                    )}

                    {/* Number in Care */}
                    <td
                      style={{
                        ...td,
                        textAlign: 'right',
                        color: (!r.isShared && r.effectiveCap != null && r.number_in_care > r.effectiveCap)
                          || (r.isShared && g.sharedMeta.avail != null && g.sharedMeta.avail < 0)
                          ? 'red'
                          : 'inherit',
                      }}
                      align="right"
                    >
                      {r.number_in_care}
                    </td>

                    {/* Available Capacity */}
                    {inSharedBlock ? (
                      isSharedFirst ? (
                        <td style={{ ...td, verticalAlign: 'top' }} align="right" rowSpan={g.sharedMeta.span}>
                          <div style={{ fontWeight: 600 }}>{g.sharedMeta.avail ?? '—'}</div>
                          <div style={{ fontSize: 12, opacity: 0.7, marginTop: 2 }}>Shared pool</div>
                        </td>
                      ) : null
                    ) : (
                      <td style={td} align="right">{r.available ?? '—'}</td>
                    )}

                    {/* Update */}
                    {/* Removed Update dropdown */}
                  </tr>
                );
              })
            )}

            {groups.length === 0 && (
              <tr>
                <td style={{ ...td, textAlign: 'center' }} colSpan={6}>
                  No data loaded yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <h2 style={{ marginTop: 40, marginBottom: 12 }}>Others</h2>
      <div
        style={{
          overflowX: 'auto',
          border: '1px solid #e5e5e5',
          borderRadius: 8,
          backgroundColor: '#fff',
          padding: 16,
        }}
      >
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              <th style={th}>Patient ID</th>
              <th style={th}>Species</th>
              <th style={th}>Age Stage</th>
              <th style={th}>Intake Date</th>
              <th style={th}>Last Checked</th>
            </tr>
          </thead>
          <tbody>
            {otherPatients.map((p, i) => (
              <tr key={p.id} style={rowStyle(i)}>
                <td style={td}>{p.id}</td>
                <td style={td}>{p.species}</td>
                <td style={td}>{p.age_stage}</td>
                <td style={td}>{p.intake_date}</td>
                <td style={td}>{p.last_check}</td>
              </tr>
            ))}
            {otherPatients.length === 0 && (
              <tr>
                <td style={{ ...td, textAlign: 'center' }} colSpan={5}>
                  No other patients.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}