document.addEventListener('DOMContentLoaded', () => {
    // Check if the user is Admin
    const currentRole = localStorage.getItem('manta_role') || 'Admin';
    if (currentRole !== 'Admin') {
        alert('Access Denied: Admin role required to access System Configuration.');
        window.location.href = '/';
        return;
    }

    const btnBackHub = document.getElementById('btn-back-hub');
    if (btnBackHub) {
        btnBackHub.addEventListener('click', () => {
            window.location.href = '/';
        });
    }

    // Load users
    loadUsersConfig();
    
    async function loadUsersConfig() {
        try {
            const res = await fetch('/api/users');
            if (!res.ok) throw new Error("Failed to fetch system users");
            const users = await res.json();
            
            const tbody = document.getElementById('table-users').querySelector('tbody');
            tbody.innerHTML = '';
            
            users.forEach(user => {
                const tr = document.createElement('tr');
                const isOnline = user.username === 'auditor1'; // simulate current user online
                
                tr.innerHTML = `
                    <td>
                        <div class="status-light-container">
                            <span class="status-light-dot ${isOnline ? 'online' : 'offline'}"></span>
                            <div>
                                <div style="font-weight:600;color:var(--text-primary);">${user.fullname}</div>
                                <div style="font-size:11px;color:var(--text-muted);margin-top:1px;">Username: ${user.username}</div>
                            </div>
                        </div>
                    </td>
                    <td>${user.email}</td>
                    <td>
                        <select class="role-select" data-user="${user.username}" style="padding:4px 8px; border-radius:4px; background:rgba(255,255,255,0.05); color:white; border:1px solid rgba(255,255,255,0.1);">
                            <option value="Admin" ${user.role === 'Admin' ? 'selected' : ''}>Admin</option>
                            <option value="Auditor" ${user.role === 'Auditor' ? 'selected' : ''}>Auditor</option>
                            <option value="Viewer" ${user.role === 'Viewer' ? 'selected' : ''}>Viewer</option>
                        </select>
                    </td>
                    <td>
                        <span class="status-pill green">Active</span>
                    </td>
                    <td>
                        <button class="btn btn-secondary btn-sm" style="padding:4px 8px;font-size:11px;">
                            <i class="fa-solid fa-user-pen"></i> Settings
                        </button>
                    </td>
                `;
                
                // Add event listener to role select dropdown trigger PUT change
                const selectEl = tr.querySelector('.role-select');
                selectEl.addEventListener('change', async (e) => {
                    const newRole = e.target.value;
                    const username = selectEl.getAttribute('data-user');
                    
                    try {
                        const putRes = await fetch(`/api/users/${username}/role`, {
                            method: 'PUT',
                            headers: {
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({ role: newRole })
                        });
                        
                        if (!putRes.ok) throw new Error("Failed to change user role");
                        
                        showToast(`Role for ${username} updated to ${newRole}!`, "success");
                    } catch (err) {
                        console.error(err);
                        showToast("Failed to update user role", "error");
                        // Reset selection
                        selectEl.value = user.role;
                    }
                });
                
                tbody.appendChild(tr);
            });
            
        } catch (err) {
            console.error("Failed to load users list:", err);
            const tbody = document.getElementById('table-users').querySelector('tbody');
            tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding: 24px; color:var(--color-high);">Error loading users.</td></tr>`;
            showToast("Failed to fetch system users.", "error");
        }
    }

    function showToast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        if (!container) return;
        
        const toast = document.createElement('div');
        let icon = 'circle-info';
        let color = 'var(--text-primary)';
        
        if (type === 'success') { icon = 'check-circle'; color = 'var(--accent-green)'; }
        if (type === 'error') { icon = 'circle-exclamation'; color = 'var(--color-high)'; }
        if (type === 'warning') { icon = 'triangle-exclamation'; color = 'var(--color-medium)'; }
        
        toast.style.cssText = `
            background: var(--bg-secondary);
            border: 1px solid var(--border-color);
            border-left: 4px solid ${color};
            padding: 12px 16px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.5);
            display: flex;
            align-items: center;
            gap: 12px;
            font-size: 14px;
            min-width: 250px;
            animation: slideIn 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
        `;
        
        toast.innerHTML = `
            <i class="fa-solid fa-${icon}" style="color:${color};font-size:18px;"></i>
            <span>${message}</span>
        `;
        
        container.appendChild(toast);
        
        setTimeout(() => {
            toast.style.animation = 'slideOut 0.3s ease forwards';
            setTimeout(() => toast.remove(), 300);
        }, 4000);
    }
});
