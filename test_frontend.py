from playwright.sync_api import sync_playwright
import time
import os

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    
    page.on("console", lambda msg: print(f"Browser Console: {msg.type}: {msg.text}"))
    page.on("pageerror", lambda err: print(f"Browser Error: {err.message}"))
    
    # Let's open the local file directly first
    filepath = "file://" + os.path.abspath("frontend/index.html")
    print(f"Opening {filepath}")
    page.goto(filepath)
    time.sleep(2)
    
    print("Uploading file...")
    file_input = page.locator("#file-input")
    file_input.set_input_files("Sample/Policy Folders Existing - Forescout.xml")
    
    time.sleep(5)
    
    print("Test finished.")
    browser.close()
