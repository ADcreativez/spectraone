import uvicorn
import sys
import os

# Ensure the root project path is in sys.path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

if __name__ == "__main__":
    print("=" * 60)
    print("Starting SpectraOne Web Server...")
    
    # SSL Configuration
    cert_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cert.pem")
    key_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "key.pem")
    
    use_ssl = os.path.exists(cert_path) and os.path.exists(key_path)
    
    if use_ssl:
        print("Access URL: https://localhost:9000 (HTTPS Enabled)")
        print("Brand focus: Forescout NAC")
        print("=" * 60)
        uvicorn.run(
            "backend.server:app", 
            host="0.0.0.0", 
            port=9000, 
            reload=True,
            ssl_keyfile=key_path,
            ssl_certfile=cert_path
        )
    else:
        print("Access URL: http://localhost:9000 (HTTP Mode)")
        print("Brand focus: Forescout NAC")
        print("=" * 60)
        print("Note: To run in HTTPS mode, place 'cert.pem' and 'key.pem' in the project root.")
        uvicorn.run("backend.server:app", host="0.0.0.0", port=9000, reload=True)
