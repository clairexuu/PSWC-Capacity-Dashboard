// seed.js
// Usage: `node seed.js`
// Make sure serviceAccountKey.json is in the same folder.

// seed.js
const admin = require("firebase-admin");
const serviceAccount = require("./pswc-capacity-dashboard-firebase-adminsdk-fbsvc-282a5a790c.json");

// Initialize Firestore
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

// --- Species List ---
const speciesList = [
  "Amphibian",
  "Coyote",
  "Deer", 
  "Beaver",
  "Bat",
  "Rat",
  "Squirrel",
  "Chipmunk",
  "Eastern Cottontail", 
  "Weasel",
  "Marten",
  "Reptile",
  "Fox",
  "Badger",
  "Fisher",
  "Skunk",
  "Raccoon",
  "Porcupine",
  "Muskrat MtBeavor Marmot",
  "River Otter",
  "Opossum"
];

// Helper: slugify species name for doc ID
function slugify(text) {
  return text
    .toString()
    .toLowerCase()
    .replace(/\s+/g, "-")         // Replace spaces with -
    .replace(/[^\w\-]+/g, "")     // Remove all non-word chars
    .replace(/\-\-+/g, "-")       // Replace multiple - with single -
    .replace(/^-+/, "")           // Trim - from start
    .replace(/-+$/, "");          // Trim - from end
}

async function seed() {
  for (const species of speciesList) {
    const slug = slugify(species);

    // Create species document
    const speciesRef = db.collection("species").doc(slug);
    await speciesRef.set({
      name: species,
      shared_capacity: 0
    });

    console.log(`Created species doc: ${slug}`);

    // Create subcollection "age"
    const ageStages = ["Infant", "Juvenile", "Adult"];
    for (const stage of ageStages) {
      await speciesRef.collection("age").doc(slugify(stage)).set({
        age: stage,
        capacity: 0,
        number_in_care: 0
      });
      console.log(`  Added age stage: ${stage}`);
    }
  }

  console.log("Seeding complete!");
}

seed()
  .then(() => process.exit(0))
  .catch(err => {
    console.error("Error seeding Firestore:", err);
    process.exit(1);
  });