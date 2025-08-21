import firebase_admin
from firebase_admin import credentials, firestore
import re

def slugify(text):
    text = text.lower()
    text = re.sub(r'[^a-z0-9]+', '-', text)
    return text.strip('-')

def initialize_firestore():
    """
    Initializes Firebase app and returns Firestore client.
    Requires serviceAccountKey.json to be in the root directory.
    """
    try:
        # Only initialize app if not already initialized
        if not firebase_admin._apps:
            cred = credentials.Certificate("../pswc-capacity-dashboard-firebase-adminsdk-fbsvc-282a5a790c.json")
            firebase_admin.initialize_app(cred)

        db = firestore.client()
        return db

    except Exception as e:
        print("Error initializing Firebase:", e)
        raise

def match_species_name(patient_species):
    """
    Attempts to match the patient species string with one of the known species in the database.
    A match is determined if any word in the patient species appears in a known species string.
    Returns the matched species name or None if no match is found.
    """
    known_species = [
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
    ]

    patient_words = set(patient_species.lower().split())
    for known in known_species:
        known_words = set(known.lower().split())
        if patient_words & known_words:
            return known
    return None

def update_capacity_count(db, species, age_stage, delta):
    species_slug = slugify(species)
    age_slug = slugify(age_stage)

    ref = db.collection("species").document(species_slug).collection("age").document(age_slug)

    @firestore.transactional
    def transaction_op(transaction):
        snapshot = ref.get(transaction=transaction)
        current = snapshot.get("number_in_care") or 0
        transaction.update(ref, {"number_in_care": max(0, current + delta)})

    transaction = db.transaction()
    transaction_op(transaction)