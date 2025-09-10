# Only for development use. Expect no future use of this script

from wrmd_scraper_core import launch_wrmd_driver, login_to_wrmd, get_pending_patients
from firebase_setup import initialize_firestore, update_capacity_count, match_species_name, match_age_stage, log_message
from datetime import datetime, timezone, timedelta

def main():
    db = initialize_firestore()
    year = "2025"

    driver, wait = launch_wrmd_driver(headless=False)
    login_to_wrmd(driver, wait)
    patients = get_pending_patients(driver, wait, year)

    for p in patients:
        page = p["page_number"]
        pid = p["case_number"]
        species_raw = p["species"]
        age_raw = p["age_stage"]
        matched_species = match_species_name(species_raw)
        matched_age = match_age_stage(age_raw)

        if matched_species is None:
            print(f"⚠️ Unmatched species for patient {pid}: Species={species_raw}")
            db.collection("other_patients").document(pid).set({
                "page_number": page,
                "patient_id": pid,
                "species": species_raw,
                "age_stage": matched_age if matched_age else age_raw,
                "status": "Pending",
                "intake_date": (
                    p["date_admitted"].astimezone(timezone(timedelta(hours=-7))).strftime("%B %d, %Y")
                    if isinstance(p["date_admitted"], datetime)
                    else datetime.strptime(p["date_admitted"], "%Y-%m-%d").astimezone(timezone(timedelta(hours=-7))).strftime("%B %d, %Y")
                ),
                "last_checked": datetime.now(timezone(timedelta(hours=-7))).strftime("%B %d, %Y at %I:%M:%S %p UTC-7")
            })
            log_message(db, page, pid, species_raw, matched_age if matched_age else age_raw, action="add", success=True)
            continue

        if matched_age is None:
            print(f"⚠️ Unmatched age stage for patient {pid}: Age={age_raw}")
            # Add to failed_patients collection
            db.collection("failed_patients").document(pid).set({
                "page_number": page,
                "patient_id": pid,
                "species": matched_species,
                "wrmd_species": species_raw,
                "raw_age": age_raw if age_raw else "",
                "status": "Pending",
                "intake_date": (
                    p["date_admitted"].astimezone(timezone(timedelta(hours=-7))).strftime("%B %d, %Y")
                    if isinstance(p["date_admitted"], datetime)
                    else datetime.strptime(p["date_admitted"], "%Y-%m-%d").astimezone(timezone(timedelta(hours=-7))).strftime("%B %d, %Y")
                ),
                "last_checked": datetime.now(timezone(timedelta(hours=-7))).strftime("%B %d, %Y at %I:%M:%S %p UTC-7")
            })
            log_message(db, page, pid, matched_species, age_raw, action="add", success=False)
            continue

        ref = db.collection("patients_in_care").document(pid)
        ref.set({
            "page_number": page,
            "patient_id": pid,
            "species": matched_species,
            "wrmd_species": species_raw,
            "age_stage": matched_age,
            "status": "Pending",
            "intake_date": (
                p["date_admitted"].astimezone(timezone(timedelta(hours=-7))).strftime("%B %d, %Y")
                if isinstance(p["date_admitted"], datetime)
                else datetime.strptime(p["date_admitted"], "%Y-%m-%d").astimezone(timezone(timedelta(hours=-7))).strftime("%B %d, %Y")
            ),
            "last_checked": datetime.now(timezone(timedelta(hours=-7))).strftime("%B %d, %Y at %I:%M:%S %p UTC-7")
        })
        update_capacity_count(db, matched_species, matched_age, delta=1)
        print(f"✅ Synced patient: {pid}")
        log_message(db, page, pid, matched_species, matched_age, action="add", success=True)

    print("✅ All pending patients synced.")
    driver.quit()

if __name__ == "__main__":
    main()
