// reset_capacity.js (CommonJS version)
const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, doc, updateDoc, deleteDoc, query } = require('firebase/firestore');
const { firebaseConfig } = require('./firebaseConfig'); 

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

(async () => {
  const speciesSnap = await getDocs(collection(db, 'species'));

  for (const speciesDoc of speciesSnap.docs) {
    const speciesId = speciesDoc.id;
    const ageSnap = await getDocs(collection(db, `species/${speciesId}/age`));

    for (const ageDoc of ageSnap.docs) {
      const ageId = ageDoc.id;
      const ageRef = doc(db, `species/${speciesId}/age/${ageId}`);
      await updateDoc(ageRef, { number_in_care: 0 });
      console.log(`✅ Reset number_in_care to 0 for: ${speciesId} / ${ageId}`);
    }
  }

  // Helper function to delete all documents in a collection
  async function clearCollection(collectionName) {
    const snap = await getDocs(collection(db, collectionName));
    for (const docSnap of snap.docs) {
      await deleteDoc(doc(db, collectionName, docSnap.id));
      console.log(`🗑️ Deleted ${docSnap.id} from ${collectionName}`);
    }
  }

  await clearCollection('other_patients');
  await clearCollection('patients_in_care');
  await clearCollection('message');

  console.log('🎉 All number_in_care fields reset.');
})();