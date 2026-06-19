from fastapi import FastAPI, UploadFile, File, HTTPException, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
import uvicorn
import os
import json
from datetime import datetime

from backend.parsers import PARSER_REGISTRY

app = FastAPI(
    title="SpectraOne API",
    description="API backend for SpectraOne cybersecurity configuration assessment tool",
    version="1.0.0"
)

# Enable CORS for development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Data Persistence setup
DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
SESSIONS_FILE = os.path.join(DATA_DIR, "sessions.json")
USERS_FILE = os.path.join(DATA_DIR, "users.json")

# Ensure data directory and files exist
os.makedirs(DATA_DIR, exist_ok=True)

if not os.path.exists(SESSIONS_FILE):
    with open(SESSIONS_FILE, "w") as f:
        json.dump([], f)

if not os.path.exists(USERS_FILE):
    default_users = [
        {
            "username": "auditor1",
            "fullname": "Security Auditor",
            "email": "auditor@spectraone.local",
            "role": "Auditor",
            "status": "Active"
        },
        {
            "username": "admin",
            "fullname": "Manta Admin",
            "email": "admin@spectraone.local",
            "role": "Admin",
            "status": "Active"
        },
        {
            "username": "viewer1",
            "fullname": "Executive Viewer",
            "email": "viewer@spectraone.local",
            "role": "Viewer",
            "status": "Active"
        }
    ]
    with open(USERS_FILE, "w") as f:
        json.dump(default_users, f, indent=4)

# Helper functions for read/write
def read_json_file(filepath):
    try:
        with open(filepath, "r") as f:
            return json.load(f)
    except Exception:
        return []

def write_json_file(filepath, data):
    try:
        with open(filepath, "w") as f:
            json.dump(data, f, indent=4)
        return True
    except Exception:
        return False

# Brand configuration with solutions and parser metadata
BRANDS = [
    {
        "id": "forescout",
        "name": "Forescout NAC",
        "solution": "Network Access Control (NAC)",
        "category": "Network Access Control (NAC)",
        "active": True,
        "icon": "network-wired",
        "description": "Forescout CounterACT policy configuration assessment (XML)",
        "accepted_formats": ["xml"],
        "upload_hint": "Upload file XML ekspor dari Forescout CounterACT (Policy Folders Export)",
        "has_template": False
    },
    {
        "id": "beyondtrust",
        "name": "BeyondTrust PAM",
        "solution": "Privileged Access Management (PAM)",
        "category": "Privileged Access Management (PAM)",
        "active": True,
        "icon": "key",
        "description": "BeyondTrust Privilege Management policy assessment — accounts, vaults, session policies",
        "accepted_formats": ["json", "zip"],
        "upload_hint": "Upload file .ZIP (kumpulan plugin BeyondTrust) atau file JSON.",
        "has_template": True
    },
    {
        "id": "symantec_dlp",
        "name": "Symantec DLP",
        "solution": "Data Loss Prevention (DLP)",
        "category": "Data Loss Prevention (DLP)",
        "active": True,
        "icon": "user-shield",
        "description": "Symantec DLP policy assessment — coverage, rule conflicts, response rules",
        "accepted_formats": ["json"],
        "upload_hint": "Upload file JSON sesuai template Symantec DLP (download template untuk panduan)",
        "has_template": True
    },
    {
        "id": "active_directory",
        "name": "Active Directory",
        "solution": "Identity & Access Management (IAM)",
        "category": "Identity & Access Management (IAM)",
        "active": True,
        "icon": "users",
        "description": "Audit Active Directory hygiene, permissions, and attack paths.",
        "accepted_formats": ["json", "xml", "zip"],
        "upload_hint": "Upload PingCastle JSON/XML, or BloodHound ZIP data.",
        "has_template": False
    },
    {
        "id": "local_exploit",
        "name": "Local Exploit Analyzer",
        "solution": "Privilege Escalation Assessment (Linux & Windows)",
        "category": "Privilege Escalation Assessment",
        "active": True,
        "icon": "terminal",
        "description": "Analyze linPEAS, winPEAS, and linux-exploit-suggester output for privilege escalation vectors",
        "accepted_formats": ["txt", "log"],
        "upload_hint": "Upload file output dari linPEAS, winPEAS, atau linux-exploit-suggester (.txt / .log)",
        "has_template": False
    }
]

@app.get("/api/brands")
def get_brands():
    """Return available cybersecurity brands with parser metadata"""
    return BRANDS

@app.get("/api/brands/{brand_id}/template")
def get_brand_template(brand_id: str):
    """Download the JSON input template for a brand (if available)"""
    template_file = os.path.join(DATA_DIR, "templates", f"{brand_id}_template.json")
    if not os.path.exists(template_file):
        raise HTTPException(status_code=404, detail=f"No template available for brand '{brand_id}'")
    return FileResponse(
        template_file,
        media_type="application/json",
        filename=f"{brand_id}_spectraone_template.json"
    )

@app.post("/api/analyze/{brand_id}")
async def analyze_config(brand_id: str, file: UploadFile = File(...)):
    """Upload and analyze a configuration file for the specified brand."""
    # Verify the brand exists and is active
    brand_config = next((b for b in BRANDS if b["id"] == brand_id), None)
    if not brand_config:
        raise HTTPException(status_code=404, detail=f"Brand '{brand_id}' not found.")
    if not brand_config["active"]:
        raise HTTPException(status_code=400, detail=f"Brand '{brand_id}' is not yet available.")

    # Verify the parser is available
    parser_class = PARSER_REGISTRY.get(brand_id)
    if not parser_class:
        raise HTTPException(status_code=501, detail=f"No parser implemented for brand '{brand_id}'.")

    # Verify file extension
    accepted = brand_config.get("accepted_formats", [])
    file_ext = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else ""
    if file_ext not in accepted:
        raise HTTPException(
            status_code=400,
            detail=f"Format '{file_ext}' tidak didukung untuk {brand_config['name']}. Format yang diterima: {', '.join(accepted).upper()}"
        )

    try:
        content_bytes = await file.read()
        content_str = content_bytes.decode('utf-8', errors='ignore')

        # Instantiate and run the correct parser
        parser = parser_class()
        result = parser.parse(content_str, file.filename, raw_bytes=content_bytes)

        # Generate session ID and save the full report result
        session_id = f"session_{int(datetime.now().timestamp() * 1000)}"
        result["session_id"] = session_id

        report_file = os.path.join(DATA_DIR, f"report_{session_id}.json")
        write_json_file(report_file, result)

        return result
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

# Backward-compat: redirect /api/analyze (no brand) to forescout
@app.post("/api/analyze")
async def analyze_config_legacy(file: UploadFile = File(...)):
    """Legacy endpoint — redirects to /api/analyze/forescout"""
    return await analyze_config("forescout", file)

# Sessions API Endpoints
@app.get("/api/sessions")
def get_sessions():
    """Get history of completed audit sessions"""
    return read_json_file(SESSIONS_FILE)

@app.post("/api/sessions")
def create_session(session_data: dict = Body(...)):
    """Save a new audit session in the history database"""
    sessions = read_json_file(SESSIONS_FILE)
    
    # Check if ID is already provided (sent from analyze result)
    if "id" not in session_data:
        session_data["id"] = f"session_{int(datetime.now().timestamp() * 1000)}"
    if "date" not in session_data:
        session_data["date"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    
    sessions.insert(0, session_data) # Insert at beginning to show newest first
    write_json_file(SESSIONS_FILE, sessions)
    
    return session_data

@app.put("/api/sessions/{session_id}/status")
def update_session_status(session_id: str, payload: dict = Body(...)):
    """Update status for a specific audit session"""
    new_status = payload.get("status")
    if new_status not in ["Completed", "In Remediation", "Resolved"]:
        raise HTTPException(status_code=400, detail="Invalid status. Must be Completed, In Remediation, or Resolved.")
        
    sessions = read_json_file(SESSIONS_FILE)
    session_found = False
    
    for s in sessions:
        if s["id"] == session_id:
            s["status"] = new_status
            session_found = True
            break
            
    if not session_found:
        raise HTTPException(status_code=404, detail="Session not found")
        
    write_json_file(SESSIONS_FILE, sessions)
    return {"status": "success", "session_id": session_id, "new_status": new_status}

@app.put("/api/sessions/{session_id}/solution")
def update_session_solution(session_id: str, payload: dict = Body(...)):
    """Update custom audit name/solution for a specific audit session"""
    new_solution = payload.get("solution")
    if not new_solution:
        raise HTTPException(status_code=400, detail="Invalid solution/name. Cannot be empty.")
        
    sessions = read_json_file(SESSIONS_FILE)
    session_found = False
    
    for s in sessions:
        if s["id"] == session_id:
            s["solution"] = new_solution
            session_found = True
            break
            
    if not session_found:
        raise HTTPException(status_code=404, detail="Session not found")
        
    write_json_file(SESSIONS_FILE, sessions)
    return {"status": "success", "session_id": session_id, "new_solution": new_solution}


@app.put("/api/sessions/{session_id}/issues")
def update_session_issues(session_id: str, payload: dict = Body(...)):
    """Update resolved status of issues and recalculate overall session status"""
    resolved_ids = payload.get("resolved_ids", [])
    
    report_file = os.path.join(DATA_DIR, f"report_{session_id}.json")
    if not os.path.exists(report_file):
        raise HTTPException(status_code=404, detail="Report data for this session was not found.")
        
    try:
        with open(report_file, "r") as f:
            report = json.load(f)
            
        issues = report.get("issues", [])
        resolved_count = 0
        
        for issue in issues:
            iss_id = issue.get("id")
            if iss_id in resolved_ids:
                issue["resolved"] = True
                resolved_count += 1
            else:
                issue["resolved"] = False
                
        # Save updated report
        with open(report_file, "w") as f:
            json.dump(report, f, indent=4)
            
        # Recalculate session status
        sessions = read_json_file(SESSIONS_FILE)
        new_status = "Completed"
        
        total_issues = len(issues)
        if total_issues > 0:
            if resolved_count == total_issues:
                new_status = "Completed"
            else:
                new_status = "In Remediation"
        else:
            new_status = "Completed"
                
        for s in sessions:
            if s["id"] == session_id:
                s["status"] = new_status
                break
                
        write_json_file(SESSIONS_FILE, sessions)
        
        return {
            "status": "success",
            "session_id": session_id,
            "resolved_count": resolved_count,
            "total_count": total_issues,
            "new_status": new_status
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update issues: {str(e)}")

@app.get("/api/sessions/{session_id}/report")
def get_session_report(session_id: str):
    """Retrieve full analysis results/tree report for a historical session"""
    report_file = os.path.join(DATA_DIR, f"report_{session_id}.json")
    if not os.path.exists(report_file):
        raise HTTPException(status_code=404, detail="Report data for this session was not found.")
        
    try:
        with open(report_file, "r") as f:
            report = json.load(f)
        
        # If audit_reference is missing or outdated, dynamically load and append/update it from the registry
        brand_id = report.get("brand_id")
        if brand_id:
            parser_class = PARSER_REGISTRY.get(brand_id)
            if parser_class:
                parser_inst = parser_class()
                saved_ref = report.get("audit_reference")
                if not saved_ref or len(saved_ref) < len(parser_inst.audit_reference):
                    report["audit_reference"] = parser_inst.audit_reference
                    # Update the report file for future requests
                    try:
                        write_json_file(report_file, report)
                    except Exception:
                        pass
        return report
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read report details: {str(e)}")

@app.delete("/api/sessions/{session_id}")
def delete_session(session_id: str):
    """Delete an audit session and its associated report file"""
    sessions = read_json_file(SESSIONS_FILE)
    original_count = len(sessions)
    
    sessions = [s for s in sessions if s["id"] != session_id]
    
    if len(sessions) == original_count:
        raise HTTPException(status_code=404, detail="Session not found")
    
    write_json_file(SESSIONS_FILE, sessions)
    
    # Also remove associated report file if it exists
    report_file = os.path.join(DATA_DIR, f"report_{session_id}.json")
    if os.path.exists(report_file):
        try:
            os.remove(report_file)
        except Exception:
            pass  # non-critical: report may already be missing
    
    return {"status": "success", "session_id": session_id, "message": "Session deleted"}

# Users API Endpoints
@app.get("/api/users")
def get_users():
    """Get system users and roles for access configuration"""
    return read_json_file(USERS_FILE)

@app.put("/api/users/{username}")
def update_user_role(username: str, payload: dict = Body(...)):
    """Update role for a specific user"""
    new_role = payload.get("role")
    if new_role not in ["Admin", "Auditor", "Viewer"]:
        raise HTTPException(status_code=400, detail="Invalid role. Must be Admin, Auditor, or Viewer.")
        
    users = read_json_file(USERS_FILE)
    user_found = False
    
    for u in users:
        if u["username"] == username:
            u["role"] = new_role
            user_found = True
            break
            
    if not user_found:
        raise HTTPException(status_code=404, detail="User not found")
        
    write_json_file(USERS_FILE, users)
    return {"status": "success", "username": username, "new_role": new_role}

# Mount the static directory to serve frontend HTML/CSS/JS
frontend_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "frontend")

@app.get("/hub")
def get_hub():
    """Explicit /hub route for the main landing page"""
    return FileResponse(os.path.join(frontend_dir, "index.html"))

@app.get("/config")
def get_config():
    """Explicit /config route for the system configuration page"""
    return FileResponse(os.path.join(frontend_dir, "config.html"))

if os.path.exists(frontend_dir):
    app.mount("/", StaticFiles(directory=frontend_dir, html=True), name="frontend")
else:
    print(f"Warning: Frontend directory '{frontend_dir}' not found. Create it to serve static files.")
