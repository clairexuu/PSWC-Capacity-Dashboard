from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import Select
from webdriver_manager.chrome import ChromeDriverManager
import time
from datetime import datetime


# -------- CONFIG --------
WRMD_URL = "https://www.wrmd.org/"
LOGIN_URL = WRMD_URL + "signin"
PATIENT_LIST_URL = WRMD_URL + "lists"
# if need to specify year of patient list
# YEAR = 2025
# PATIENT_LIST_YEAR_URL = PATIENT_LIST_URL +  "?change_year_to=" + YEAR

# WRMD credentials
WRMD_USERNAME = "xinyix26@uw.edu"
WRMD_PASSWORD = "DataCX1"

def launch_wrmd_driver(headless=True):
    """
    Launches a Chrome browser (optionally headless) and returns a tuple (driver, wait).
    """
    options = Options()
    if headless:
        options.add_argument("--headless=new")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")

    service = Service(ChromeDriverManager().install())
    driver = webdriver.Chrome(service=service, options=options)
    wait = WebDriverWait(driver, 10)

    return driver, wait


def login_to_wrmd(driver, wait, email=WRMD_USERNAME, password=WRMD_PASSWORD):
    """
    Logs into the WRMD system using provided credentials.
    """
    driver.get(LOGIN_URL)

    wait.until(EC.presence_of_element_located((By.ID, "email"))).send_keys(email)
    driver.find_element(By.ID, "password").send_keys(password)
    driver.find_element(By.ID, "password").send_keys(Keys.RETURN)

    # Optional: wait for redirect to dashboard
    time.sleep(3)

    print("✅ Logged in to WRMD")


def get_pending_patients(driver, wait, since_date=None):
    """
    Scrapes all patients with disposition == 'Pending' from WRMD.
    If since_date is provided, only includes patients admitted after that date.
    Returns a list of dicts with patient data: case_number, species, date_admitted, and age_stage.
    """
    results = []

    driver.get(PATIENT_LIST_URL)
    wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, 'table.table')))
    time.sleep(2)

    # Determine total pages
    pagination_links = driver.find_elements(By.CSS_SELECTOR, 'ul.pagination li a[href^="#"]')
    page_numbers = [int(p.text) for p in pagination_links if p.text.strip().isdigit()]
    total_pages = max(page_numbers) if page_numbers else 1
    print(f"Total pages: {total_pages}")

    # Determine page order
    # page_range = range(1, total_pages + 1) if since_date is None else range(total_pages, 0, -1)
    # Debug mode: only check the last page
    page_range = [1, 2, 3, 4, 5, 6, 7, 8, 9]

    for page in page_range:
        print(f"Processing page {page}...")
        wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, 'table.table')))
        time.sleep(1)

        rows = driver.find_elements(By.CSS_SELECTOR, "table.table tbody tr")
        for row in rows:
            try:
                cells = row.find_elements(By.TAG_NAME, "td")
            except Exception:
                continue
            if len(cells) < 9:
                print(f"⚠️ Row has only {len(cells)} columns. Proceeding anyway.")

            try:
                case_number = cells[1].text.strip()
                species_name = cells[2].text.strip()
                disposition = cells[4].text.strip()
                date_admitted_str = cells[8].text.strip()  # last column is Date Admitted

                try:
                    date_admitted = datetime.strptime(date_admitted_str, "%m/%d/%Y")
                except ValueError:
                    print(f"⚠️ Skipping row {case_number} due to invalid date: {date_admitted_str}")
                    continue

                if since_date and date_admitted < since_date:
                    print("⏹️ Reached date before threshold — stopping early.")
                    return results

                if disposition.lower() == "pending":
                    link = cells[2].find_element(By.TAG_NAME, "a")  # link is in species column
                    link.send_keys(Keys.COMMAND + Keys.RETURN)  # or Keys.COMMAND on Mac
                    time.sleep(2)
                    driver.switch_to.window(driver.window_handles[-1])

                    # Click the "Initial Care" tab
                    selected_age_stage = None
                    try:
                        initial_care_link = driver.find_element(By.PARTIAL_LINK_TEXT, "Initial Care")
                        initial_care_link.click()
                        time.sleep(2)
                    except Exception as e:
                        print(f"⚠️ Failed to click 'Initial Care': {e}")

                    # Extract age stage from Initial Care tab
                    try:
                        age_stage_select = driver.find_element(By.NAME, "exams[age_unit]")
                        selected_age_stage = age_stage_select.find_element(By.CSS_SELECTOR, "option:checked").text.strip()
                    except Exception as e:
                        print(f"⚠️ Failed to extract age stage: {e}")

                    print(f"Added pending patient: Case #{case_number}, Species: {species_name}, Age: {selected_age_stage}, Date Admitted: {date_admitted.strftime('%Y-%m-%d')}")
                    results.append({
                        "case_number": case_number,
                        "species": species_name,
                        "date_admitted": date_admitted,
                        "age_stage": selected_age_stage,
                    })

                    driver.close()
                    driver.switch_to.window(driver.window_handles[0])

            except Exception as e:
                print(f"⚠️ Error handling row: {e}")

        # Go to next/prev page
        if (since_date is None and page < total_pages) or (since_date and page > 1):
            pagination_links = driver.find_elements(By.CSS_SELECTOR, 'ul.pagination li a[href^="#"]')
            for p in pagination_links:
                if p.text.strip() == str(page + 1 if since_date is None else page - 1):
                    driver.execute_script("arguments[0].click();", p)
                    break
            time.sleep(1)

    return results