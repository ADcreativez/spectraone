import sys
import os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from backend.parsers.forescout import ForescoutParser

try:
    with open("Sample/Policy Folders Existing - Forescout.xml", "r") as f:
        content = f.read()
    
    parser = ForescoutParser()
    res = parser.parse(content, "Sample/Policy Folders Existing - Forescout.xml")
    print("SUCCESS")
    print(res.keys())
    print("Issues:", len(res["issues"]))
except Exception as e:
    import traceback
    traceback.print_exc()

