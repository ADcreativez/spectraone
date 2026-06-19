from playwright.sync_api import sync_playwright
import time
import os

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    
    page.on("console", lambda msg: print(f"Browser Console: {msg.type}: {msg.text}"))
    page.on("pageerror", lambda err: print(f"Browser Error: {err.message}\nStack: {err.stack}"))
    
    url = "http://localhost:9000/workspace.html?module=active_directory"
    print(f"Opening {url}")
    page.goto(url)
    time.sleep(2)
    
    print("Uploading large AD sample file...")
    file_input = page.locator("#file-input")
    file_input.set_input_files("Sample/AD_Large_Sample.json")
    
    print("Waiting for parsing and UI rendering...")
    time.sleep(6)
    
    # Click Attack Paths Graph tab
    print("Clicking Attack Paths Graph tab...")
    page.click('.tab-btn[data-tab="tab-ad-graph"]')
    time.sleep(5)
    
    # Check loader visibility
    loader_display = page.evaluate("document.getElementById('graph-loading') ? document.getElementById('graph-loading').style.display : 'none'")
    print(f"Graph loader display status: '{loader_display}'")
    
    # Check if vis.js network canvas is populated
    canvas_html = page.evaluate("document.getElementById('ad-graph-canvas') ? document.getElementById('ad-graph-canvas').innerHTML : ''")
    print(f"Canvas inner HTML length: {len(canvas_html)}")
    
    print("Test finished.")
    browser.close()
