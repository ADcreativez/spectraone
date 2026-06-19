from playwright.sync_api import sync_playwright
import os

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    
    filepath = "file://" + os.path.abspath("frontend/index.html")
    page.goto(filepath)
    
    # Try to evaluate JS to check elements
    print("modal-close-btn:", page.evaluate("document.getElementById('modal-close-btn') !== null"))
    print("modal-ok-btn:", page.evaluate("document.getElementById('modal-ok-btn') !== null"))
    print("loader-overlay:", page.evaluate("document.getElementById('loader-overlay') !== null"))
    
    browser.close()
