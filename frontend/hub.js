document.addEventListener('DOMContentLoaded', async () => {
    // 1. Authentication Check
    const loggedUserStr = localStorage.getItem('manta_user');
    if (!loggedUserStr) {
        window.location.href = '/login.html';
        return;
    }
    const loggedUser = JSON.parse(loggedUserStr);
    const currentRole = loggedUser.role;

    const hubContainer = document.getElementById('module-hub-container');
    
    // Intercept fetch if running via file://
    const API_BASE = window.location.protocol === 'file:' ? 'http://127.0.0.1:9000' : '';
    const apiUrl = API_BASE ? API_BASE + '/api/brands' : '/api/brands';
    
    try {
        const res = await fetch(apiUrl);
        if (!res.ok) throw new Error("Failed to load brands configuration");
        const brandsConfig = await res.json();
        
        hubContainer.innerHTML = '';
        
        brandsConfig.forEach(brand => {
            // Enforcement: check if user has access to this module (Admin has access to everything)
            const isAllowed = loggedUser.role === 'Admin' || (loggedUser.allowed_modules && loggedUser.allowed_modules.includes(brand.id));
            if (!isAllowed) return; // skip card rendering
            
            const hubCard = document.createElement('div');
            hubCard.className = `module-hub-card ${brand.active ? '' : 'disabled'}`;
            hubCard.innerHTML = `
                <div class="module-hub-card-icon">
                    <i class="fa-solid fa-${brand.icon}"></i>
                </div>
                <div class="module-hub-card-content">
                    <h3>${brand.name}</h3>
                    <p>${brand.solution}</p>
                </div>
                <div class="module-hub-card-footer">
                    <div class="module-hub-card-badges">
                        ${!brand.active ? '<span class="module-hub-card-badge" style="color:var(--text-muted);border-color:var(--border-color);background:rgba(255,255,255,0.05);">Coming Soon</span>' : (brand.accepted_formats ? brand.accepted_formats.map(f => `<span class="module-hub-card-badge">${f.toUpperCase()}</span>`).join('') : '')}
                    </div>
                    <div class="module-hub-card-arrow">
                        <i class="fa-solid fa-arrow-right"></i>
                    </div>
                </div>
            `;
            
            if (brand.active) {
                hubCard.addEventListener('click', () => {
                    window.location.href = `/workspace.html?module=${brand.id}`;
                });
            } else {
                hubCard.addEventListener('click', () => {
                    alert(`The '${brand.name}' module is coming soon!`);
                });
            }
            
            hubContainer.appendChild(hubCard);
        });
        
        if (hubContainer.children.length === 0) {
            hubContainer.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 48px; color: var(--text-muted);">Anda tidak memiliki akses ke modul manapun. Hubungi Admin.</div>`;
        }
        
    } catch (err) {
        console.error(err);
        hubContainer.innerHTML = `<div style="color:var(--color-high);">Failed to load assessment modules. Please check if the API server is running.</div>`;
    }
    
    // User Panel & Role Setup
    const roleSpan = document.getElementById('current-hub-role');
    const btnUserRole = document.getElementById('btn-user-role');
    const btnConfig = document.getElementById('btn-config');
    const btnLogout = document.getElementById('btn-logout');
    
    if (roleSpan) {
        roleSpan.textContent = `${loggedUser.fullname} (${loggedUser.role})`;
        if (loggedUser.organization) {
            roleSpan.title = `Org: ${loggedUser.organization}`;
        }
    }
    
    // Show Config button only if user is Admin
    if (btnConfig) {
        if (currentRole === 'Admin') {
            btnConfig.style.display = 'inline-flex';
            btnConfig.addEventListener('click', () => {
                window.location.href = '/config.html';
            });
        } else {
            btnConfig.style.display = 'none';
        }
    }
    
    if (btnLogout) {
        btnLogout.addEventListener('click', () => {
            localStorage.removeItem('manta_user');
            localStorage.removeItem('manta_token');
            localStorage.removeItem('manta_role');
            alert('Logged out successfully.');
            window.location.href = '/login.html';
        });
    }
});
