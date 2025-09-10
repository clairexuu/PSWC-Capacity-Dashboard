from wrmd_scraper_core import (
    launch_wrmd_driver,
    login_to_wrmd,
    get_pending_patients
)
from firebase_setup import initialize_firestore, update_capacity_count, match_species_name, match_age_stage, log_message
from datetime import datetime, timezone, timedelta
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import InvalidSessionIdException, NoSuchWindowException, StaleElementReferenceException
import time
import platform
from selenium.webdriver.common.keys import Keys

PATIENT_LIST_URL = "https://www.wrmd.org/lists"

def get_wid_in_care(db):
    """
    Fetches all document IDs (wrmd_ids) in the patients_in_care, other_patients, and failed_patients collections.
    Returns a tuple of (wrmd_ids_by_year excluding failed patients, failed_patients_by_year)
    """
    wrmd_ids_by_year = {}
    failed_patients_by_year = {}

    for collection_name in ["patients_in_care", "other_patients", "failed_patients"]:
        patients_ref = db.collection(collection_name)
        docs = patients_ref.stream()
        for doc in docs:
            wid = doc.id
            year_prefix = wid.split("-")[0]
            
            # Track failed patients separately and DON'T include them in wrmd_ids_by_year
            if collection_name == "failed_patients":
                if year_prefix not in failed_patients_by_year:
                    failed_patients_by_year[year_prefix] = []
                failed_patients_by_year[year_prefix].append(wid)
            else:
                # Only add patients_in_care and other_patients to wrmd_ids_by_year
                if year_prefix not in wrmd_ids_by_year:
                    wrmd_ids_by_year[year_prefix] = []
                wrmd_ids_by_year[year_prefix].append(wid)

    return wrmd_ids_by_year, failed_patients_by_year

def check_failed_patients(driver, wait, db, failed_patients_list, year, current_time_stamp):
    """
    Check failed patients to see if they now have valid age stages.
    If valid, move them to patients_in_care or other_patients.
    Returns a set of patient IDs that were processed (moved or removed).
    """
    processed_patients = set()
    
    if not failed_patients_list:
        return processed_patients
    
    print(f"🔄 Checking {len(failed_patients_list)} failed patients for valid age stages...")
    
    # Group failed patients by page
    failed_by_page = {}
    for wid in failed_patients_list:
        doc = db.collection("failed_patients").document(wid).get()
        if doc.exists:
            data = doc.to_dict()
            page_num = data.get("page_number", 1)
            if page_num not in failed_by_page:
                failed_by_page[page_num] = []
            failed_by_page[page_num].append((wid, data))
    
    # Check each failed patient
    for page_num in sorted(failed_by_page.keys()):
        print(f"📄 Checking page {page_num} for failed patients...")
        url = f"{PATIENT_LIST_URL}?change_year_to={year}&page={page_num}"
        driver.get(url)
        wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, 'table.table')))
        # Wait longer for all rows to load
        time.sleep(5)
        
        # Additional wait to ensure dynamic content is loaded
        try:
            wait.until(lambda d: len(d.find_elements(By.CSS_SELECTOR, "table.table tbody tr")) > 0)
        except:
            print(f"⚠️ No rows found on page {page_num}, waiting longer...")
            time.sleep(3)
        
        rows = driver.find_elements(By.CSS_SELECTOR, "table.table tbody tr")
        for i, row in enumerate(rows):
            try:
                # Re-find the row to avoid stale element reference
                current_rows = driver.find_elements(By.CSS_SELECTOR, "table.table tbody tr")
                if i >= len(current_rows):
                    break
                row = current_rows[i]
                cells = row.find_elements(By.TAG_NAME, "td")
            except (InvalidSessionIdException, NoSuchWindowException, StaleElementReferenceException) as e:
                print(f"⚠️ Error while processing row {i}: {e}")
                print("   Attempting to recover...")
                # Try to switch back to main window if possible
                try:
                    if driver.window_handles:
                        driver.switch_to.window(driver.window_handles[0])
                    continue
                except:
                    print("   ❌ Failed to recover session. Skipping remaining rows.")
                    break
            if len(cells) < 8:
                continue
            case_number = cells[1].text.strip()
            
            # Check if this is one of our failed patients
            if case_number in [p[0] for p in failed_by_page[page_num]]:
                patient_data = next(p[1] for p in failed_by_page[page_num] if p[0] == case_number)
                species_raw = patient_data.get("wrmd_species", "")
                matched_species = patient_data.get("species", "")
                
                # First check disposition - if not pending, remove from failed_patients
                disposition = cells[4].text.strip().lower() if len(cells) > 4 else ""
                
                if ("died" in disposition or "euthanized" in disposition or "released" in disposition or
                    "dead" in disposition or "transferred" in disposition or "void" in disposition):
                    # Patient is no longer pending, remove from failed_patients
                    db.collection("failed_patients").document(case_number).delete()
                    processed_patients.add(case_number)
                    print(f"❌ Removed failed patient {case_number} - disposition: {disposition}")
                    continue
                
                # Only check age stage if disposition is still pending
                if disposition != "pending":
                    print(f"⚠️ Skipping failed patient {case_number} - unexpected disposition: {disposition}")
                    continue
                
                # Open detail page to check age stage
                try:
                    # Store the main window handle
                    main_window = driver.current_window_handle
                    original_windows = driver.window_handles.copy()
                    
                    link = cells[2].find_element(By.TAG_NAME, "a")
                    
                    # Scroll to element and ensure it's visible
                    driver.execute_script("arguments[0].scrollIntoView(true);", link)
                    time.sleep(0.5)
                    
                    # Use platform-specific key combinations
                    if platform.system() == 'Darwin':  # Mac
                        link.send_keys(Keys.COMMAND + Keys.RETURN)
                    else:  # Linux/Windows
                        link.send_keys(Keys.CONTROL + Keys.RETURN)
                    
                    # Wait longer and retry if needed
                    max_retries = 3
                    for retry in range(max_retries):
                        time.sleep(2 + retry)  # Progressive wait: 2s, 3s, 4s
                        new_windows = [w for w in driver.window_handles if w not in original_windows]
                        if new_windows:
                            break
                        if retry < max_retries - 1:
                            print(f"⚠️ Retry {retry + 1}: Waiting for new tab for patient {case_number}")
                    
                    if not new_windows:
                        print(f"⚠️ Failed to open new tab for patient {case_number} after {max_retries} attempts")
                        continue
                    
                    driver.switch_to.window(new_windows[0])
                    
                    age_stage_raw = None
                    try:
                        initial_care_link = driver.find_element(By.PARTIAL_LINK_TEXT, "Initial Care")
                        driver.execute_script("arguments[0].scrollIntoView(true);", initial_care_link)
                        time.sleep(1)
                        driver.execute_script("arguments[0].click();", initial_care_link)
                        time.sleep(2)
                    except Exception as e:
                        print(f"⚠️ Failed to click 'Initial Care': {e}")
                    
                    try:
                        wait.until(EC.presence_of_element_located((By.NAME, "exams[age_unit]")))
                        age_stage_select = driver.find_element(By.NAME, "exams[age_unit]")
                        age_stage_raw = age_stage_select.find_element(By.CSS_SELECTOR, "option:checked").text.strip()
                    except Exception as e:
                        print(f"⚠️ Failed to extract age stage: {e}")
                    
                    # Close the tab and switch back
                    driver.close()
                    driver.switch_to.window(main_window)
                    
                    # Check if age is now valid
                    matched_age = match_age_stage(age_stage_raw if age_stage_raw else "")
                    
                    if matched_age is not None:
                        # Move to appropriate collection
                        if matched_species:
                            # Move to patients_in_care
                            db.collection("patients_in_care").document(case_number).set({
                                "page_number": page_num,
                                "patient_id": case_number,
                                "species": matched_species,
                                "wrmd_species": species_raw,
                                "age_stage": matched_age,
                                "status": "Pending",
                                "intake_date": patient_data.get("intake_date", ""),
                                "last_checked": current_time_stamp
                            })
                            update_capacity_count(db, matched_species, matched_age, delta=1)
                            log_message(db, page_num, case_number, matched_species, matched_age, action="add", success=True)
                            processed_patients.add(case_number)
                            print(f"✅ Moved patient {case_number} from failed_patients to patients_in_care")
                        else:
                            # Move to other_patients
                            db.collection("other_patients").document(case_number).set({
                                "page_number": page_num,
                                "patient_id": case_number,
                                "species": species_raw,
                                "age_stage": matched_age,
                                "status": "Pending",
                                "intake_date": patient_data.get("intake_date", ""),
                                "last_checked": current_time_stamp
                            })
                            log_message(db, page_num, case_number, species_raw, matched_age, action="add", success=True)
                            processed_patients.add(case_number)
                            print(f"✅ Moved patient {case_number} from failed_patients to other_patients")
                        
                        # Delete from failed_patients
                        db.collection("failed_patients").document(case_number).delete()
                    else:
                        # Age still invalid, just update last_checked
                        db.collection("failed_patients").document(case_number).update({
                            "last_checked": current_time_stamp,
                            "raw_age": age_stage_raw if age_stage_raw else ""
                        })
                        print(f"⚠️ Patient {case_number} still has invalid age: {age_stage_raw}")
                        
                except Exception as e:
                    print(f"⚠️ Failed to check failed patient {case_number}: {e}")

    return processed_patients

def check_and_update_dispositions(driver, wait, db, wrmd_ids_by_year, failed_patients_by_year):
    current_time_stamp = datetime.now(timezone.utc).isoformat()

    for year_prefix, wrmd_ids_list in wrmd_ids_by_year.items():
        year = "20" + year_prefix
        print(f"🔍 Processing year: {year}")

        # Group wrmd_ids by their page numbers from the database
        patients_by_page = {}
        for wid in wrmd_ids_list:
            # Get the page number from the database
            doc = db.collection("patients_in_care").document(wid).get()
            if not doc.exists:
                doc = db.collection("other_patients").document(wid).get()
            if doc.exists:
                data = doc.to_dict()
                page_num = data.get("page_number", 1)
                if page_num not in patients_by_page:
                    patients_by_page[page_num] = []
                patients_by_page[page_num].append((wid, data))

        checked_ids = set()
        max_page_checked = 0

        # First, check existing patients by directly going to their pages
        for page_num in sorted(patients_by_page.keys()):
            print(f"📄 Checking page {page_num} for existing patients...")
            url = f"{PATIENT_LIST_URL}?change_year_to={year}&page={page_num}"
            driver.get(url)
            wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, 'table.table')))
            
            # Scroll to bottom to trigger any lazy loading
            driver.execute_script("window.scrollTo(0, document.body.scrollHeight);")
            time.sleep(2)
            
            # Scroll back up
            driver.execute_script("window.scrollTo(0, 0);")
            time.sleep(3)
            
            # Wait for rows to load
            try:
                wait.until(lambda d: len(d.find_elements(By.CSS_SELECTOR, "table.table tbody tr")) > 0)
            except:
                print(f"⚠️ No rows found on page {page_num}, waiting longer...")
                time.sleep(3)

            rows = driver.find_elements(By.CSS_SELECTOR, "table.table tbody tr")
            expected_patients = [p[0] for p in patients_by_page[page_num]]
            print(f"   Found {len(rows)} rows on page {page_num} (expecting {len(expected_patients)} specific patients)")
            
            # Debug: print all case numbers found on this page
            found_case_numbers = []
            for row in rows[:5]:  # Just check first 5 for debugging
                try:
                    cells = row.find_elements(By.TAG_NAME, "td")
                    if len(cells) >= 2:
                        found_case_numbers.append(cells[1].text.strip())
                except:
                    pass
            if found_case_numbers:
                print(f"   First few case numbers on page: {', '.join(found_case_numbers)}")
            
            # Check if expected patients are in the found case numbers
            if expected_patients:
                print(f"   Looking for: {', '.join(expected_patients[:5])}")  # Show first 5 expected
            
            for i, row in enumerate(rows):
                try:
                    # Re-find the row to avoid stale element reference
                    current_rows = driver.find_elements(By.CSS_SELECTOR, "table.table tbody tr")
                    if i >= len(current_rows):
                        break
                    row = current_rows[i]
                    cells = row.find_elements(By.TAG_NAME, "td")
                except (InvalidSessionIdException, NoSuchWindowException, StaleElementReferenceException) as e:
                    print(f"⚠️ Session error while processing row {i}: {e}")
                    print("   Attempting to recover...")
                    try:
                        if driver.window_handles:
                            driver.switch_to.window(driver.window_handles[0])
                        continue
                    except:
                        print("   ❌ Failed to recover session. Skipping remaining rows.")
                        break
                if len(cells) < 8:
                    continue
                case_number = cells[1].text.strip()
                disposition = cells[4].text.strip().lower()

                if case_number in [p[0] for p in patients_by_page[page_num]]:
                    checked_ids.add(case_number)
                    patient_data = next(p[1] for p in patients_by_page[page_num] if p[0] == case_number)
                    species = patient_data.get("species", "")
                    age_stage = patient_data.get("age_stage", "")

                    if ("died" in disposition or "euthanized" in disposition or "released" in disposition or
                        "dead" in disposition or "transferred" in disposition or "void" in disposition):
                        # Check which collection the patient is in before deleting
                        was_in_care = db.collection("patients_in_care").document(case_number).get().exists
                        
                        db.collection("patients_in_care").document(case_number).delete()
                        db.collection("other_patients").document(case_number).delete()
                        
                        # Only update capacity if patient was in patients_in_care
                        if was_in_care and species:
                            update_capacity_count(db, species, age_stage, delta=-1)
                        print(f"❌ Removed patient: {case_number}")
                    else:
                        print(f"🔁 Patient still pending: {case_number}")
            
            max_page_checked = max(max_page_checked, page_num)

        # Check failed patients if any exist for this year
        if year_prefix in failed_patients_by_year:
            processed_failed_patients = check_failed_patients(driver, wait, db, failed_patients_by_year[year_prefix], year, current_time_stamp)
            # Add processed failed patients to checked_ids to prevent double counting
            checked_ids.update(processed_failed_patients)

        # Get total pages to check for new patients
        pagination_links = driver.find_elements(By.CSS_SELECTOR, 'ul.pagination li a[href^="#"]')
        page_numbers = [int(p.text) for p in pagination_links if p.text.strip().isdigit()]
        total_pages = max(page_numbers) if page_numbers else 1
        print(f"Total pages in year {year}: {total_pages}")

        # Now check for new patients starting from the last checked page
        print(f"🔍 Checking for new patients from page {max_page_checked} to {total_pages}...")
        for page in range(max_page_checked, total_pages + 1):
            if page != max_page_checked:
                url = f"{PATIENT_LIST_URL}?change_year_to={year}&page={page}"
                driver.get(url)
                wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, 'table.table')))
                # Wait longer for all rows to load
                time.sleep(5)
                
                # Additional wait to ensure dynamic content is loaded
                try:
                    wait.until(lambda d: len(d.find_elements(By.CSS_SELECTOR, "table.table tbody tr")) > 0)
                except:
                    print(f"⚠️ No rows found on page {page}, waiting longer...")
                    time.sleep(3)

            rows = driver.find_elements(By.CSS_SELECTOR, "table.table tbody tr")
            print(f"   Found {len(rows)} rows on page {page}")
            
            for i, row in enumerate(rows):
                try:
                    # Re-find the row to avoid stale element reference
                    current_rows = driver.find_elements(By.CSS_SELECTOR, "table.table tbody tr")
                    if i >= len(current_rows):
                        break
                    row = current_rows[i]
                    cells = row.find_elements(By.TAG_NAME, "td")
                except (InvalidSessionIdException, NoSuchWindowException, StaleElementReferenceException) as e:
                    print(f"⚠️ Session error while processing row {i}: {e}")
                    print("   Attempting to recover...")
                    try:
                        if driver.window_handles:
                            driver.switch_to.window(driver.window_handles[0])
                        continue
                    except:
                        print("   ❌ Failed to recover session. Skipping remaining rows.")
                        break
                if len(cells) < 8:
                    continue
                case_number = cells[1].text.strip()
                disposition = cells[4].text.strip().lower()
                admit_date_str = cells[8].text.strip()

                try:
                    admit_date = datetime.strptime(admit_date_str, "%m/%d/%Y")
                except ValueError:
                    print(f"⚠️ Skipping row {case_number} due to invalid date: {admit_date_str}")
                    continue

                # Check for new pending patients
                if disposition == "pending" and case_number not in checked_ids and case_number not in wrmd_ids_list:
                    # Treat as new patient
                    species_raw = cells[2].text.strip()
                    age_stage_raw = None

                    try:
                        # Store the main window handle
                        main_window = driver.current_window_handle
                        original_windows = driver.window_handles.copy()
                        
                        link = cells[2].find_element(By.TAG_NAME, "a")
                        
                        # Scroll to element and ensure it's visible
                        driver.execute_script("arguments[0].scrollIntoView(true);", link)
                        time.sleep(0.5)
                        
                        # Use platform-specific key combinations
                        if platform.system() == 'Darwin':  # Mac
                            link.send_keys(Keys.COMMAND + Keys.RETURN)
                        else:  # Linux/Windows
                            link.send_keys(Keys.CONTROL + Keys.RETURN)
                        
                        # Wait longer and retry if needed
                        max_retries = 3
                        for retry in range(max_retries):
                            time.sleep(2 + retry)  # Progressive wait: 2s, 3s, 4s
                            new_windows = [w for w in driver.window_handles if w not in original_windows]
                            if new_windows:
                                break
                            if retry < max_retries - 1:
                                print(f"⚠️ Retry {retry + 1}: Waiting for new tab for patient {case_number}")
                        
                        if not new_windows:
                            print(f"⚠️ Failed to open new tab for patient {case_number} after {max_retries} attempts")
                            # Add to failed_patients collection to retry in next run
                            matched_species = match_species_name(species_raw)
                            db.collection("failed_patients").document(case_number).set({
                                "page_number": page,
                                "patient_id": case_number,
                                "species": matched_species,
                                "wrmd_species": species_raw,
                                "raw_age": "unknown",
                                "status": "Pending",
                                "intake_date": admit_date.strftime("%B %d, %Y"),
                                "last_checked": current_time_stamp,
                                "reason": "failed_to_open_tab"
                            })
                            print(f"📝 Added to failed_patients (tab opening failed): {case_number}")
                            continue
                        
                        driver.switch_to.window(new_windows[0])

                        try:
                            initial_care_link = driver.find_element(By.PARTIAL_LINK_TEXT, "Initial Care")
                            driver.execute_script("arguments[0].scrollIntoView(true);", initial_care_link)
                            time.sleep(1)
                            driver.execute_script("arguments[0].click();", initial_care_link)
                            time.sleep(2)
                        except Exception as e:
                            print(f"⚠️ Failed to click 'Initial Care': {e}")

                        try:
                            wait.until(EC.presence_of_element_located((By.NAME, "exams[age_unit]")))
                            age_stage_select = driver.find_element(By.NAME, "exams[age_unit]")
                            age_stage_raw = age_stage_select.find_element(By.CSS_SELECTOR, "option:checked").text.strip()
                        except Exception as e:
                            print(f"⚠️ Failed to extract age stage: {e}")

                        # Close the tab and switch back
                        driver.close()
                        driver.switch_to.window(main_window)

                    except Exception as e:
                        print(f"⚠️ Failed to open patient detail page: {e}")
                        # Add to failed_patients collection to retry in next run
                        matched_species = match_species_name(species_raw)
                        db.collection("failed_patients").document(case_number).set({
                            "page_number": page,
                            "patient_id": case_number,
                            "species": matched_species,
                            "wrmd_species": species_raw,
                            "raw_age": "unknown",
                            "status": "Pending",
                            "intake_date": admit_date.strftime("%B %d, %Y"),
                            "last_checked": current_time_stamp,
                            "reason": f"page_access_error: {str(e)}"
                        })
                        print(f"📝 Added to failed_patients (page access error): {case_number}")
                        continue

                    matched_species = match_species_name(species_raw)
                    matched_age = match_age_stage(age_stage_raw if age_stage_raw else "")

                    if matched_species is not None:
                        if matched_age is not None:
                            doc_ref = db.collection("patients_in_care").document(case_number)
                            doc_ref.set({
                                "page_number": page,
                                "patient_id": case_number,
                                "species": matched_species,
                                "wrmd_species": species_raw,
                                "age_stage": matched_age,
                                "status": "Pending",
                                "intake_date": admit_date.strftime("%B %d, %Y"),
                                "last_checked": current_time_stamp
                            })
                            update_capacity_count(db, matched_species, matched_age, delta=1)
                            log_message(db, page, case_number, matched_species, matched_age, action="add", success=True)
                            print(f"➕ Added new patient: {case_number}")
                        else:
                            # Add to failed_patients collection
                            db.collection("failed_patients").document(case_number).set({
                                "page_number": page,
                                "patient_id": case_number,
                                "species": matched_species,
                                "wrmd_species": species_raw,
                                "raw_age": age_stage_raw if age_stage_raw else "",
                                "status": "Pending",
                                "intake_date": admit_date.strftime("%B %d, %Y"),
                                "last_checked": current_time_stamp
                            })
                            log_message(db, page, case_number, matched_species, age_stage_raw, action="add", success=False)
                            print(f"⚠️ Added to failed_patients (invalid age): {case_number}")
                    else:
                        db.collection("other_patients").document(case_number).set({
                            "page_number": page,
                            "patient_id": case_number,
                            "species": species_raw,
                            "age_stage": age_stage_raw,
                            "status": "Pending",
                            "intake_date": admit_date.strftime("%B %d, %Y"),
                            "last_checked": current_time_stamp
                        })
                        log_message(db, page, case_number, species_raw, age_stage_raw, action="add", success=True)
                        print(f"✅ Added to other_patients: {case_number}")

        # Report any patients that weren't found
        remaining = set(wrmd_ids_list) - checked_ids
        for missing in remaining:
            print(f"⚠️ Patient {missing} not found on expected page - may have been deleted from WRMD")

def main():
    # Initialize Firestore
    db = initialize_firestore()
    
    # Record the start time
    start_time = datetime.now(timezone(timedelta(hours=-7)))
    
    try:
        # Launch Selenium driver
        driver, wait = launch_wrmd_driver(headless=True)
        login_to_wrmd(driver, wait)

        # Get all patients currently in care (including failed patients)
        wrmd_ids_by_year, failed_patients_by_year = get_wid_in_care(db)

        # Check WRMD and update statuses, including adding new patients and checking failed patients
        check_and_update_dispositions(driver, wait, db, wrmd_ids_by_year, failed_patients_by_year)

        driver.quit()
        
        # Record successful completion
        db.collection("system").document("last_update").set({
            "timestamp": start_time.strftime("%B %d, %Y at %I:%M:%S %p"),
            "status": "success",
            "updated_at": start_time
        })
        
        print("✅ All patients updated.")
        
    except Exception as e:
        # Record failure
        db.collection("system").document("last_update").set({
            "timestamp": start_time.strftime("%B %d, %Y at %I:%M:%S %p"),
            "status": "failed",
            "error": str(e),
            "updated_at": start_time
        })
        
        print(f"❌ Update failed: {e}")
        # Re-raise the exception
        raise e

if __name__ == "__main__":
    main()