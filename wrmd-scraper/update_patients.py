from wrmd_scraper_core import (
    launch_wrmd_driver,
    login_to_wrmd,
    get_pending_patients
)
from firebase_setup import initialize_firestore, update_capacity_count, match_species_name
from datetime import datetime, timezone
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
import time

PATIENT_LIST_URL = "https://www.wrmd.org/lists"

def get_current_patients_in_care(db):
    """
    Fetches all document IDs (wrmd_ids) in the patients_in_care collection.
    """
    patients_ref = db.collection("patients_in_care")
    docs = patients_ref.stream()
    return [doc.id for doc in docs]

def check_and_update_dispositions(driver, wait, db, wrmd_ids):
    """
    Check each page in reverse order and verify if any listed patient matches a wrmd_id.
    If a patient's disposition is no longer pending, update Firestore accordingly.
    """
    driver.get(PATIENT_LIST_URL)
    wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, 'table.table')))
    time.sleep(2)

    # Determine total pages
    pagination_links = driver.find_elements(By.CSS_SELECTOR, 'ul.pagination li a[href^="#"]')
    page_numbers = [int(p.text) for p in pagination_links if p.text.strip().isdigit()]
    total_pages = max(page_numbers) if page_numbers else 1
    print(f"Total pages: {total_pages}")

    page_range = range(total_pages, 0, -1)
    checked_ids = set()

    for page in page_range:
        if page != total_pages:
            pagination_links = driver.find_elements(By.CSS_SELECTOR, 'ul.pagination li a[href^="#"]')
            for p in pagination_links:
                if p.text.strip() == str(page):
                    driver.execute_script("arguments[0].click();", p)
                    time.sleep(1)
                    break

        rows = driver.find_elements(By.CSS_SELECTOR, "table.table tbody tr")
        for row in rows:
            cells = row.find_elements(By.TAG_NAME, "td")
            if len(cells) < 8:
                continue
            case_number = cells[0].text.strip()
            disposition = cells[3].text.strip().lower()

            if case_number in wrmd_ids and case_number not in checked_ids:
                checked_ids.add(case_number)

                if "dead" in disposition or "euthanize" in disposition or "release" in disposition:
                    doc = db.collection("patients_in_care").document(case_number).get()
                    if doc.exists:
                        data = doc.to_dict()
                        species = data["species"]
                        age_stage = data["age_stage"]
                        db.collection("patients_in_care").document(case_number).delete()
                        update_capacity_count(db, species, age_stage, delta=-1)
                        print(f"❌ Removed patient: {case_number}")
                else:
                    print(f"🔁 Patient still pending: {case_number}")

                if len(checked_ids) == len(wrmd_ids):
                    print("✅ All patients checked.")
                    return

    remaining = set(wrmd_ids) - checked_ids
    for missing in remaining:
        print(f"⚠️ Patient {missing} not found.")

def main():
    # Initialize Firestore
    db = initialize_firestore()

    # Launch Selenium driver
    driver, wait = launch_wrmd_driver(headless=True)
    login_to_wrmd(driver, wait)

    # Get all patients currently in care
    wrmd_ids = get_current_patients_in_care(db)

    # Check WRMD and update statuses
    check_and_update_dispositions(driver, wait, db, wrmd_ids)

    # Get newly admitted patients since now
    since_date = datetime.now(timezone.utc)
    new_patients = get_pending_patients(driver, since_date=since_date)

    # Add new patients to Firestore and update capacity
    for patient in new_patients:
        matched_species = match_species_name(patient["species"])
        doc_ref = db.collection("patients_in_care").document(patient["case_number"])
        doc_ref.set({
            "species": matched_species,
            "age_stage": patient["age_stage"],
            "timestamp": datetime.now(timezone.utc).isoformat()
        })
        update_capacity_count(db, matched_species, patient["age_stage"], delta=1)
        print(f"➕ Added new patient: {patient['case_number']}")

    print("✅ All patients updated.")
    driver.quit()

if __name__ == "__main__":
    main()