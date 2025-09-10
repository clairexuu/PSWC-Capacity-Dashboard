import firebase_admin
from firebase_admin import credentials, firestore
import re
from datetime import datetime, timezone, timedelta
import uuid

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
            cred = credentials.Certificate("pswc-capacity-dashboard-firebase-adminsdk-fbsvc-282a5a790c.json")
            firebase_admin.initialize_app(cred)

        db = firestore.client()
        return db

    except Exception as e:
        print("Error initializing Firebase:", e)
        raise

def match_species_name(patient_species):
    """
    Match the patient species string with one of the known species in the database.
    A match is determined by scanning words in patient species from right to left and
    checking if any of those words appear in the known species.
    Returns the matched species name or None if no match is found.
    """
    known_species = [
        "Amphibian",
        "Coyote",
        "Deer",
        "Beaver",
        "Bat",
        "Rat Mouse",
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
        "Opossum",
        "Pigeon"
    ]

    patient_words = patient_species.lower().split()[::-1]  # reverse the order
    for word in patient_words:
        for known in known_species:
            known_words = set(known.lower().split())
            if word in known_words:
                return known
    return None


def match_age_stage(age_stage_scraped):
    """
    Normalizes age stage from WRMD to match the database schema.
    - 'Neonate' and 'Infant' to 'Infant'
    - 'Juvenile' and 'Sub-adult' to 'Juvenile'
    - 'Adult' to 'Adult'
    Returns the matched age stage string or None if no match is found.
    """
    age_stage_scraped = age_stage_scraped.strip().lower()
    if age_stage_scraped in ['neonate', 'infant']:
        return 'Infant'
    elif age_stage_scraped in ['juvenile']:
        return 'Juvenile'
    elif age_stage_scraped in ['sub-adult', 'subadult', 'adult']:
        return 'Adult'
    else:
        return None

def update_capacity_count(db, species, age_stage, delta):
    species_slug = slugify(species)
    age_stage = age_stage.lower()

    ref = db.collection("species").document(species_slug).collection("age").document(age_stage)

    @firestore.transactional
    def transaction_op(transaction):
        snapshot = ref.get(transaction=transaction)
        current = snapshot.get("number_in_care") or 0
        transaction.update(ref, {"number_in_care": max(0, current + delta)})

    transaction = db.transaction()
    transaction_op(transaction)

def log_message(db, page_number, patient_id, species, age_stage, action, success):
    message_ref = db.collection("message")

    # Check total count and enforce 100-document limit
    messages = list(message_ref.order_by("timestamp", direction=firestore.Query.ASCENDING).stream())
    if len(messages) >= 100:
        oldest_doc = messages[0]
        oldest_doc.reference.delete()

    # Add new message
    message_ref.document(str(uuid.uuid4())).set({
        "patient_id": patient_id,
        "page_number": page_number,
        "species": species,
        "age_stage": age_stage,
        "action": action,
        "success": success,
        "timestamp": datetime.now(timezone.utc).astimezone(timezone(timedelta(hours=-7))).strftime("%B %d, %Y at %I:%M:%S %p UTC-7")
    })