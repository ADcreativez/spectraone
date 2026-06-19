document.addEventListener('DOMContentLoaded', async () => {
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
        
    } catch (err) {
        console.error(err);
        hubContainer.innerHTML = `<div style="color:var(--color-high);">Failed to load assessment modules. Please check if the API server is running.</div>`;
    }
    
    // Role-Based Simulation
    let currentRole = localStorage.getItem('manta_role') || 'Admin';
    const roleSpan = document.getElementById('current-hub-role');
    const btnUserRole = document.getElementById('btn-user-role');
    const btnConfig = document.getElementById('btn-config');
    const btnLogout = document.getElementById('btn-logout');
    
    if (roleSpan) roleSpan.textContent = currentRole;
    
    if (btnUserRole) {
        btnUserRole.addEventListener('click', () => {
            currentRole = currentRole === 'Admin' ? 'User' : 'Admin';
            localStorage.setItem('manta_role', currentRole);
            if (roleSpan) roleSpan.textContent = currentRole;
        });
    }
    
    if (btnConfig) {
        btnConfig.addEventListener('click', () => {
            if (currentRole === 'Admin') {
                window.location.href = '/config.html';
            } else {
                alert('Access Denied: Admin role required to access System Configuration.');
            }
        });
    }
    
    if (btnLogout) {
        btnLogout.addEventListener('click', () => {
            localStorage.removeItem('manta_role');
            alert('Logged out successfully.');
            window.location.reload();
        });
    }
});
