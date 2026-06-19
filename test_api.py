import requests

url = "http://127.0.0.1:9000/api/analyze/forescout"
files = {'file': open('Sample/Policy Folders Existing - Forescout.xml', 'rb')}

print("Sending request...")
response = requests.post(url, files=files)
print(f"Status Code: {response.status_code}")

try:
    data = response.json()
    print("Parsed JSON successfully.")
    print("Keys:", data.keys())
except Exception as e:
    print("Failed to parse JSON:", str(e))
    print("Response text:", response.text[:500])
