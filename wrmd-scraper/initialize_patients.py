from wrmd_scraper_core import launch_wrmd_driver, login_to_wrmd, get_pending_patients
from firebase_setup import initialize_firestore, update_capacity_count, match_species_name
from datetime import datetime, timezone

def main():
    db = initialize_firestore()
    driver, wait = launch_wrmd_driver(headless=False)

    login_to_wrmd(driver, wait)
    patients = get_pending_patients(driver, wait)

    for p in patients:
        pid = p["case_number"]
        matched_species = match_species_name(p["species"])
        if matched_species is None:
            print(f"⚠️ Could not match species for patient {pid}: {p['species']}")
            continue
        ref = db.collection("patients_in_care").document(pid)

        ref.set({
            "patient_id": pid,
            "species": matched_species,
            "age_stage": p["age_stage"],
            "status": "Pending",
            "intake_date": p["date_admitted"],
            "last_checked": datetime.now(timezone.utc).isoformat()
        })

        update_capacity_count(db, matched_species, p["age_stage"], delta=1)
        print(f"✅ Synced patient: {pid}")

    print("✅ All pending patients synced.")
    driver.quit()

if __name__ == "__main__":
    main()