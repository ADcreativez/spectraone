import json

users = []
# Create 1000 users
# We need to distribute specific properties to trigger all 15 checklists:
# ad-01: Inactive (lastlogontimestamp = -1 or stale = True) -> 100 users
# ad-02: Domain Admins (admincount = True) -> 15 users
# ad-03: Password Never Expires -> 50 users
# ad-04: Service Account & Password Never Expires -> 20 users
# ad-06: Unconstrained Delegation (unconstraineddelegation = True) -> 5 users
# ad-08: AS-REP Roasting (dontreqpreauth = True) -> 8 users
# ad-09: Inheritance broken (inheritance_broken = True) -> 12 users
# ad-10: Backup/Account Operator -> 6 users
# ad-11: SPN / Kerberoastable (hasspn = True) -> 30 users

for i in range(1000):
    username = f"user{i:04d}@MANTAINSIGHT.LOCAL"
    props = {
        "name": username,
        "enabled": True,
        "admincount": False
    }
    
    if i < 15:
        props["name"] = f"Admin{i:02d}@MANTAINSIGHT.LOCAL"
        props["admincount"] = True
    elif i < 115: # 100 users stale
        props["name"] = f"StaleUser{i-15:02d}@MANTAINSIGHT.LOCAL"
        props["stale"] = True
        props["enabled"] = False if (i % 3 == 0) else True # some disabled
    elif i < 165: # 50 users password never expires
        props["name"] = f"NeverExpireUser{i-115:02d}@MANTAINSIGHT.LOCAL"
        props["passwordneverexpires"] = True
    elif i < 185: # 20 service accounts
        props["name"] = f"svc-backup-db{i-165:02d}@MANTAINSIGHT.LOCAL"
        props["passwordneverexpires"] = True
    elif i < 190: # 5 unconstrained delegation
        props["name"] = f"delegation-user{i-185:02d}@MANTAINSIGHT.LOCAL"
        props["unconstraineddelegation"] = True
    elif i < 198: # 8 dontreqpreauth
        props["name"] = f"asrep-user{i-190:02d}@MANTAINSIGHT.LOCAL"
        props["dontreqpreauth"] = True
    elif i < 210: # 12 inheritance broken
        props["name"] = f"protected-user{i-198:02d}@MANTAINSIGHT.LOCAL"
        props["inheritance_broken"] = True
    elif i < 216: # 6 operators
        props["name"] = f"operator-backup{i-210:02d}@MANTAINSIGHT.LOCAL"
        props["is_operator"] = True
    elif i < 246: # 30 kerberoastable
        props["name"] = f"tgs-service-web{i-216:02d}@MANTAINSIGHT.LOCAL"
        props["hasspn"] = True
        props["serviceprincipalnames"] = f"HTTP/web-service{i-216:02d}.mantainsight.local"
    elif i == 999: # krbtgt
        props["name"] = "krbtgt@MANTAINSIGHT.LOCAL"
        props["pwdlastset"] = 1600000000 # very old
        
    users.append({
        "ObjectIdentifier": f"S-1-5-21-12345-{500+i}",
        "Properties": props
    })

computers = []
# Create 2000 computers
# ad-07: LAPS Not Enabled (haslaps = False) -> 1200 computers
# ad-12: SMB Signing Disabled (smb_signing_disabled = True) -> 800 computers
for i in range(2000):
    # Let's assign some to be Printers & IoT devices
    if i < 50:
        compname = f"PRN-{i:02d}.MANTAINSIGHT.LOCAL"
    elif i < 100:
        compname = f"VOIP-{i-50:02d}.MANTAINSIGHT.LOCAL"
    elif i < 150:
        compname = f"CAM-CCTV-{i-100:02d}.MANTAINSIGHT.LOCAL"
    elif i < 170:
        compname = f"SCANNER-{i-150:02d}.MANTAINSIGHT.LOCAL"
    else:
        compname = f"COMP-{i:04d}.MANTAINSIGHT.LOCAL"
        
    props = {
        "name": compname,
        "haslaps": True
    }
    
    # ad-07: 1200 computers laps disabled
    if i < 1200:
        props["haslaps"] = False
    
    # ad-12: 800 computers smb signing disabled
    if i >= 1200:
        props["smb_signing_disabled"] = True
        
    computers.append({
        "ObjectIdentifier": f"S-1-5-21-12345-{2000+i}",
        "Properties": props
    })

groups = [
    {"ObjectIdentifier": "S-1-5-21-12345-512", "Properties": {"name": "Domain Admins@MANTAINSIGHT.LOCAL"}},
    {"ObjectIdentifier": "S-1-5-21-12345-513", "Properties": {"name": "Domain Users@MANTAINSIGHT.LOCAL"}},
    {"ObjectIdentifier": "S-1-5-21-12345-514", "Properties": {"name": "Domain Guests@MANTAINSIGHT.LOCAL"}},
    {"ObjectIdentifier": "S-1-5-21-12345-515", "Properties": {"name": "Account Operators@MANTAINSIGHT.LOCAL"}},
    {"ObjectIdentifier": "S-1-5-21-12345-516", "Properties": {"name": "Backup Operators@MANTAINSIGHT.LOCAL"}},
    {"ObjectIdentifier": "S-1-5-21-12345-517", "Properties": {"name": "Enterprise Admins@MANTAINSIGHT.LOCAL"}},
    {"ObjectIdentifier": "S-1-5-21-12345-518", "Properties": {"name": "Schema Admins@MANTAINSIGHT.LOCAL"}},
    {"ObjectIdentifier": "S-1-5-21-12345-519", "Properties": {"name": "Server Operators@MANTAINSIGHT.LOCAL"}},
    {"ObjectIdentifier": "S-1-5-21-12345-520", "Properties": {"name": "Print Operators@MANTAINSIGHT.LOCAL"}},
    {"ObjectIdentifier": "S-1-5-21-12345-521", "Properties": {"name": "Cert Publishers@MANTAINSIGHT.LOCAL"}},
    {"ObjectIdentifier": "S-1-5-21-12345-522", "Properties": {"name": "Group Policy Creator Owners@MANTAINSIGHT.LOCAL"}},
    {"ObjectIdentifier": "S-1-5-21-12345-523", "Properties": {"name": "Cryptographic Operators@MANTAINSIGHT.LOCAL"}},
]

domain_stats = {
    "gpp_passwords_found": True, # ad-13
    "ldap_signing_disabled": True, # ad-14
    "krbtgt_password_age_years": 4.5 # ad-15
}

data = {
    "users": users,
    "computers": computers,
    "groups": groups,
    "domain": domain_stats
}

with open("/Users/macbookpro/ErwanzCode/Mantainsight/Sample/AD_Large_Sample.json", "w") as f:
    json.dump(data, f, indent=2)

print("Successfully generated AD_Large_Sample.json!")
