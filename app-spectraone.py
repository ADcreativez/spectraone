import uvicorn
import sys
import os

# Ensure the root project path is in sys.path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

if __name__ == "__main__":
    print("=" * 60)
    print("Starting SpectraOne Web Server...")
    print("Access URL: http://localhost:9000")
    print("Brand focus: Forescout NAC")
    print("=" * 60)
    
    # Run server
    uvicorn.run("backend.server:app", host="0.0.0.0", port=9000, reload=True)
