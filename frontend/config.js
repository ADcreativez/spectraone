document.addEventListener('DOMContentLoaded', () => {
    // Check if the user is Admin
    const loggedUserStr = localStorage.getItem('manta_user');
    if (!loggedUserStr) {
        window.location.href = '/login.html';
        return;
    }
    const loggedUser = JSON.parse(loggedUserStr);
    if (loggedUser.role !== 'Admin') {
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

    // Modal elements
    const userModal = document.getElementById('user-modal');
    const userModalTitle = document.getElementById('user-modal-title');
    const userModalClose = document.getElementById('user-modal-close');
    const btnCancelUser = document.getElementById('btn-cancel-user');
    const btnCreateUser = document.getElementById('btn-create-user');
    const formUser = document.getElementById('form-user');
    
    const inputMode = document.getElementById('edit-user-mode');
    const inputUsername = document.getElementById('edit-username');
    const inputFullname = document.getElementById('edit-fullname');
    const inputEmail = document.getElementById('edit-email');
    const inputOrganization = document.getElementById('edit-organization');
    const inputPassword = document.getElementById('edit-password');
    const labelPassword = document.getElementById('label-password');
    const inputRole = document.getElementById('edit-role');
    const moduleCheckboxes = document.querySelectorAll('.module-cb');

    let allUsers = [];

    // Load users
    loadUsersConfig();
    
    async function loadUsersConfig() {
        try {
            const res = await fetch('/api/users');
            if (!res.ok) throw new Error("Failed to fetch system users");
            allUsers = await res.json();
            
            const tbody = document.getElementById('table-users').querySelector('tbody');
            tbody.innerHTML = '';
            
            allUsers.forEach(user => {
                const tr = document.createElement('tr');
                const isOnline = user.username === loggedUser.username;
                
                const modulesBadges = user.allowed_modules && user.allowed_modules.length > 0 
                    ? user.allowed_modules.map(m => `<span class="module-hub-card-badge" style="font-size:10px; margin-right:4px;">${m}</span>`).join('')
                    : '<span style="color:var(--text-muted); font-size:12px;">None</span>';
                
                tr.innerHTML = `
                    <td>
                        <div class="status-light-container" style="display:flex; align-items:center; gap:10px;">
                            <span class="status-light-dot ${isOnline ? 'online' : 'offline'}" style="width:8px; height:8px; border-radius:50%; background:${isOnline ? 'var(--accent-green)' : 'var(--text-muted)'}; display:inline-block;"></span>
                            <div>
                                <div style="font-weight:600;color:var(--text-primary);">${user.fullname}</div>
                                <div style="font-size:11px;color:var(--text-muted);margin-top:1px;">Username: ${user.username}</div>
                            </div>
                        </div>
                    </td>
                    <td>${user.email}</td>
                    <td style="font-weight:500;">${user.organization || 'SpectraOne Local'}</td>
                    <td>
                        <div style="display:flex; flex-wrap:wrap; gap:4px; max-width: 250px;">
                            ${modulesBadges}
                        </div>
                    </td>
                    <td>
                        <span class="status-pill" style="padding:4px 8px; border-radius:6px; font-size:11px; font-weight:600; background:rgba(99,102,241,0.15); color:var(--accent-indigo); border:1px solid rgba(99,102,241,0.25);">${user.role}</span>
                    </td>
                    <td>
                        <div style="display:flex; gap:6px;">
                            <button class="btn btn-secondary btn-sm btn-edit" data-user="${user.username}" style="padding:4px 8px;font-size:11px;">
                                <i class="fa-solid fa-user-pen"></i> Edit
                            </button>
                            <button class="btn btn-sm btn-delete" data-user="${user.username}" style="padding:4px 8px;font-size:11px;background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.25);color:var(--color-high);border-radius:6px;cursor:pointer; display:${isOnline ? 'none' : 'block'};">
                                <i class="fa-solid fa-trash-can"></i>
                            </button>
                        </div>
                    </td>
                `;
                
                tbody.appendChild(tr);
            });

            // Bind edit button events
            tbody.querySelectorAll('.btn-edit').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const username = btn.getAttribute('data-user');
                    const user = allUsers.find(u => u.username === username);
                    if (user) {
                        openUserModal('edit', user);
                    }
                });
            });

            // Bind delete button events
            tbody.querySelectorAll('.btn-delete').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    const username = btn.getAttribute('data-user');
                    const confirmed = window.confirm(`Apakah Anda yakin ingin menghapus user "${username}"?`);
                    if (!confirmed) return;

                    try {
                        const delRes = await fetch(`/api/users/${username}`, {
                            method: 'DELETE'
                        });
                        if (!delRes.ok) throw new Error("Gagal menghapus user");
                        showToast(`User ${username} berhasil dihapus!`, "success");
                        loadUsersConfig();
                    } catch (err) {
                        showToast(err.message, "error");
                    }
                });
            });
            
        } catch (err) {
            console.error("Failed to load users list:", err);
            const tbody = document.getElementById('table-users').querySelector('tbody');
            tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 24px; color:var(--color-high);">Error loading users.</td></tr>`;
            showToast("Failed to fetch system users.", "error");
        }
    }

    // Modal Control Functions
    function openUserModal(mode, user = null) {
        inputMode.value = mode;
        inputPassword.value = '';
        
        // Reset checkboxes
        moduleCheckboxes.forEach(cb => cb.checked = false);

        if (mode === 'create') {
            userModalTitle.textContent = "Tambah User Baru";
            inputUsername.value = '';
            inputUsername.disabled = false;
            inputFullname.value = '';
            inputEmail.value = '';
            inputOrganization.value = 'SpectraOne Local';
            inputRole.value = 'Viewer';
            inputPassword.required = true;
            labelPassword.textContent = "Password";
            inputPassword.placeholder = "Masukkan password";
        } else if (mode === 'edit' && user) {
            userModalTitle.textContent = `Edit User: ${user.username}`;
            inputUsername.value = user.username;
            inputUsername.disabled = true; // Cannot edit username
            inputFullname.value = user.fullname;
            inputEmail.value = user.email;
            inputOrganization.value = user.organization || '';
            inputRole.value = user.role;
            inputPassword.required = false;
            labelPassword.textContent = "Ganti Password (Opsional)";
            inputPassword.placeholder = "Kosongkan jika tidak ingin diubah";

            // Check checkboxes
            if (user.allowed_modules) {
                moduleCheckboxes.forEach(cb => {
                    if (user.allowed_modules.includes(cb.value)) {
                        cb.checked = true;
                    }
                });
            }
        }

        userModal.style.display = 'flex';
    }

    function closeUserModal() {
        userModal.style.display = 'none';
    }

    if (btnCreateUser) {
        btnCreateUser.addEventListener('click', () => openUserModal('create'));
    }

    if (userModalClose) userModalClose.addEventListener('click', closeUserModal);
    if (btnCancelUser) btnCancelUser.addEventListener('click', closeUserModal);
    
    // Close modal on backdrop click
    userModal.addEventListener('click', (e) => {
        if (e.target === userModal) closeUserModal();
    });

    // Form submit logic
    formUser.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const mode = inputMode.value;
        const username = inputUsername.value.trim();
        
        const allowed_modules = [];
        moduleCheckboxes.forEach(cb => {
            if (cb.checked) allowed_modules.push(cb.value);
        });

        const payload = {
            fullname: inputFullname.value.trim(),
            email: inputEmail.value.trim(),
            organization: inputOrganization.value.trim(),
            role: inputRole.value,
            allowed_modules: allowed_modules
        };

        if (inputPassword.value) {
            payload.password = inputPassword.value;
        }

        try {
            let res;
            if (mode === 'create') {
                payload.username = username;
                res = await fetch('/api/users', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
            } else {
                res = await fetch(`/api/users/${username}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
            }

            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.detail || "Gagal menyimpan user");
            }

            showToast(mode === 'create' ? "User baru berhasil dibuat!" : "User settings berhasil diperbarui!", "success");
            closeUserModal();
            loadUsersConfig();
        } catch (err) {
            showToast(err.message, "error");
        }
    });

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
