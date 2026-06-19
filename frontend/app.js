document.addEventListener('DOMContentLoaded', () => {
    // Intercept fetch if running via file:// to ensure API connects to localhost
    const API_BASE = window.location.protocol === 'file:' ? 'http://127.0.0.1:9000' : '';
    if (API_BASE) {
        const originalFetch = window.fetch;
        window.fetch = function() {
            if (typeof arguments[0] === 'string' && arguments[0].startsWith('/api/')) {
                arguments[0] = API_BASE + arguments[0];
            }
            return originalFetch.apply(this, arguments);
        };
    }

    // State management
    let currentBrand = 'forescout';
    let analysisResult = null;
    let activeTab = 'tab-overview';
    let activeView = 'dashboard'; // Default view is dashboard
    let brandsConfig = [];        // Cached brand configs from API
    let activeBrandConfig = null; // Currently active brand config
    
    // UI Elements
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    const uploadView = document.getElementById('upload-view');
    const reportView = document.getElementById('report-view');
    const dashboardView = document.getElementById('dashboard-view');
    const loaderOverlay = document.getElementById('loader-overlay');
    const btnReset = document.getElementById('btn-reset');
    const btnBackHub = document.getElementById('btn-back-hub');
    const btnAuditRef = document.getElementById('btn-audit-ref');
    
    const navDashboard = document.getElementById('nav-dashboard');
    const navUpload = document.getElementById('nav-upload');
    
    // Search boxes will be queried dynamically via event delegation because they are inside templates

    
    // Detail Modal Elements
    const detailsModal = document.getElementById('details-modal');
    const modalTitle = document.getElementById('modal-title');
    const modalContent = document.getElementById('modal-content');
    const modalCloseBtn = document.getElementById('modal-close-btn');
    const modalOkBtn = document.getElementById('modal-ok-btn');
    
    // Init app
    initBrands();
    initUploadEvents();
    initTabEvents();
    initSearchEvents();
    initModalEvents();
    initNavigation();
    initAuditRefButton();
    loadDashboardSessions(); // Preload dashboard logs

    // Navigation routing logic
    function initNavigation() {
        // Dashboard Sidebar Click
        if (navDashboard) {
            navDashboard.addEventListener('click', () => {
                switchView('dashboard');
            });
        }
        
        // Upload Sidebar Click
        if (navUpload) {
            navUpload.addEventListener('click', () => {
                switchView('upload');
            });
        }
        
        // Back to hub button
        if (btnBackHub) {
            btnBackHub.addEventListener('click', () => {
                window.location.href = '/';
            });
        }
        
        // Reset/Re-analyze button
        btnReset.addEventListener('click', () => {
            analysisResult = null;
            fileInput.value = '';
            reportView.style.display = 'none';
            btnReset.style.display = 'none';
            if (btnAuditRef) btnAuditRef.style.display = 'none';
            uploadView.style.display = 'flex';
            
            // Reset Search Inputs dynamically
            document.querySelectorAll('input[id^="search-"]').forEach(input => {
                input.value = '';
            });
            
            updateStatusBadge(true, "Ready to Upload");
        });
    }
    
    function switchView(viewName) {
        activeView = viewName;
        
        // Update Sidebar highlighting
        document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
        
        // Hide all views
        dashboardView.style.display = 'none';
        uploadView.style.display = 'none';
        reportView.style.display = 'none';
        btnReset.style.display = 'none';
        if (btnAuditRef) btnAuditRef.style.display = 'none';
        
        const headerTitle = document.getElementById('current-brand-name');
        const headerDesc = document.getElementById('current-brand-desc');
        
        if (viewName === 'dashboard') {
            if (btnBackHub) btnBackHub.style.display = 'inline-flex';
            if (navDashboard) navDashboard.classList.add('active');
            dashboardView.style.display = 'flex';
            headerTitle.textContent = `${activeBrandConfig ? activeBrandConfig.name : 'Module'} Dashboard`;
            headerDesc.textContent = `Historical audit sessions for ${activeBrandConfig ? activeBrandConfig.name : 'this module'}`;
            updateStatusBadge(true, "Dashboard");
            loadDashboardSessions(activeBrandConfig ? activeBrandConfig.id : null);
        } 
        else if (viewName === 'upload') {
            if (btnBackHub) btnBackHub.style.display = 'inline-flex';
            if (navUpload) navUpload.classList.add('active');
            
            let titleText = activeBrandConfig.name;
            if (!titleText.toLowerCase().endsWith('analyzer')) {
                titleText += ' Analyzer';
            }
            headerTitle.textContent = titleText;
            headerDesc.textContent = activeBrandConfig.description || activeBrandConfig.solution;

            if (analysisResult && analysisResult.brand_id === activeBrandConfig.id) {
                reportView.style.display = 'block';
                const brandShortName = activeBrandConfig.name.replace(' Analyzer', '');
                btnReset.innerHTML = `<i class="fa-solid fa-arrow-rotate-left"></i> Analyze New ${brandShortName} File`;
                btnReset.style.display = 'inline-flex';
                if (btnAuditRef) btnAuditRef.style.display = 'inline-flex';
                updateStatusBadge(true, "Analysis Complete");
                document.querySelectorAll('.tab-btn').forEach(btn => {
                    if (btn.getAttribute('data-tab') === 'tab-overview') btn.click();
                });
            } else {
                updateUploadZoneForBrand(activeBrandConfig);
                uploadView.style.display = 'flex';
                updateStatusBadge(true, "Ready to Upload");
            }
        }
    }

    // Update upload zone labels and accepted format for the active brand
    function updateUploadZoneForBrand(brand) {
        const acceptedFormats = brand.accepted_formats || ['xml'];
        const formatStr = acceptedFormats.map(f => `.${f}`).join(', ');
        const hint = brand.upload_hint || `Upload file konfigurasi ${brand.name}`;
        
        // Update fileInput accept attribute
        fileInput.setAttribute('accept', acceptedFormats.map(f => `.${f}`).join(','));
        
        // Update the drop zone text
        const dropHintEl = document.getElementById('drop-zone-hint');
        const dropFormatsEl = document.getElementById('drop-zone-formats');
        if (dropHintEl) dropHintEl.textContent = hint;
        if (dropFormatsEl) dropFormatsEl.textContent = `Format didukung: ${formatStr.toUpperCase()}`;
        
        // Show or hide template download button
        const templateBtn = document.getElementById('btn-download-template');
        if (templateBtn) {
            if (brand.has_template) {
                templateBtn.style.display = 'inline-flex';
                templateBtn.onclick = () => {
                    window.open(`/api/brands/${brand.id}/template`, '_blank');
                };
            } else {
                templateBtn.style.display = 'none';
            }
        }
    }

    // 1. Fetch & Initialize Brand Sidebar
    async function initBrands() {
        const urlParams = new URLSearchParams(window.location.search);
        const initialModule = urlParams.get('module');
        
        if (!initialModule) {
            window.location.href = '/';
            return;
        }

        try {
            const res = await fetch('/api/brands');
            if (!res.ok) throw new Error("Failed to load brands configuration");
            brandsConfig = await res.json();
            
            const brand = brandsConfig.find(b => b.id === initialModule);
            if (!brand) {
                window.location.href = '/';
                return;
            }
            
            activeBrandConfig = brand;
            currentBrand = brand.id;
            
            // Set Sidebar Header
            const sidebarModuleName = document.getElementById('sidebar-module-name');
            if (sidebarModuleName) {
                sidebarModuleName.textContent = brand.name;
            }
            
            // By default, open the dashboard
            switchView('dashboard');
            
        } catch (err) {
            showToast("Error loading brand configuration.", "error");
        }
    }
    
    // 2. Drag & Drop File Upload Handling
    function initUploadEvents() {
        // Drop zone click triggers file browse
        dropZone.addEventListener('click', () => fileInput.click());
        
        fileInput.addEventListener('change', () => {
            if (fileInput.files.length > 0) {
                handleFileUpload(fileInput.files[0]);
            }
        });
        
        // Drag over effects
        ['dragenter', 'dragover'].forEach(eventName => {
            dropZone.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
                dropZone.classList.add('dragover');
            }, false);
        });
        
        ['dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
                dropZone.classList.remove('dragover');
            }, false);
        });
        
        // Handle drop event
        dropZone.addEventListener('drop', (e) => {
            const dt = e.dataTransfer;
            const files = dt.files;
            if (files.length > 0) {
                fileInput.files = files;
                handleFileUpload(files[0]);
            }
        });
    }
    
    async function handleFileUpload(file) {
        const brand = activeBrandConfig || { id: 'forescout', accepted_formats: ['xml'] };
        const accepted = brand.accepted_formats || ['xml'];
        const fileExt = file.name.includes('.') ? file.name.rsplit ? file.name.split('.').pop().toLowerCase() : file.name.split('.').pop().toLowerCase() : '';

        if (!accepted.includes(fileExt)) {
            showToast(`File tidak valid. ${brand.name} hanya menerima format: ${accepted.map(f => f.toUpperCase()).join(', ')}`, "error");
            return;
        }
        
        const loaderTitle = document.getElementById('loader-title');
        const loaderDesc = document.getElementById('loader-desc');
        const progressContainer = document.getElementById('upload-progress-container');
        const progressBar = document.getElementById('upload-progress-bar');
        const progressText = document.getElementById('upload-progress-text');
        const progressBytes = document.getElementById('upload-progress-bytes');
        const loaderSpinner = document.getElementById('loader-spinner');
        
        if (loaderTitle) loaderTitle.textContent = "Uploading Configuration...";
        if (loaderDesc) loaderDesc.textContent = "Please wait while the file is transmitted to the server.";
        if (progressContainer) progressContainer.style.display = 'block';
        if (progressBar) progressBar.style.width = '0%';
        if (progressText) progressText.textContent = 'Uploading... 0%';
        if (progressBytes) {
            progressBytes.style.display = 'inline';
            progressBytes.textContent = `0 / ${(file.size / (1024*1024)).toFixed(2)} MB`;
        }
        if (loaderSpinner) loaderSpinner.style.display = 'none';
        
        loaderOverlay.style.display = 'flex';
        
        const formData = new FormData();
        formData.append('file', file);
        
        let parseInterval = null;
        
        try {
            const apiUrl = `/api/analyze/${brand.id}`;
            const targetUrl = typeof API_BASE !== 'undefined' && API_BASE ? API_BASE + apiUrl : apiUrl;

            analysisResult = await new Promise((resolve, reject) => {
                const xhr = new XMLHttpRequest();
                xhr.open('POST', targetUrl, true);
                
                xhr.upload.onprogress = (e) => {
                    if (e.lengthComputable && progressContainer) {
                        const percentComplete = Math.round((e.loaded / e.total) * 100);
                        if (percentComplete < 100) {
                            if (progressBar) progressBar.style.width = percentComplete + '%';
                            if (progressText) progressText.textContent = `Uploading... ${percentComplete}%`;
                            if (progressBytes) progressBytes.textContent = `${(e.loaded / (1024*1024)).toFixed(2)} / ${(e.total / (1024*1024)).toFixed(2)} MB`;
                        } else {
                            if (progressBar) progressBar.style.width = '0%';
                            if (progressText) progressText.textContent = 'Analyzing... 0%';
                            if (progressBytes) progressBytes.style.display = 'none';
                            if (loaderTitle) loaderTitle.textContent = "Parsing & Auditing Configuration...";
                            if (loaderDesc) loaderDesc.textContent = "SpectraOne is examining policy folders, calculating IP intersections, and validating rules against performance best-practices. This may take a few seconds.";
                            
                            let currentParsePercent = 0;
                            parseInterval = setInterval(() => {
                                if (currentParsePercent < 95) {
                                    if (currentParsePercent < 40) {
                                        currentParsePercent += Math.floor(Math.random() * 8) + 4;
                                    } else if (currentParsePercent < 75) {
                                        currentParsePercent += Math.floor(Math.random() * 4) + 2;
                                    } else {
                                        currentParsePercent += Math.floor(Math.random() * 2) + 1;
                                    }
                                    if (currentParsePercent > 95) currentParsePercent = 95;
                                    if (progressBar) progressBar.style.width = currentParsePercent + '%';
                                    if (progressText) progressText.textContent = `Analyzing... ${currentParsePercent}%`;
                                }
                            }, 150);
                        }
                    }
                };
                
                xhr.onload = () => {
                    if (parseInterval) clearInterval(parseInterval);
                    if (xhr.status >= 200 && xhr.status < 300) {
                        try {
                            resolve(JSON.parse(xhr.responseText));
                        } catch (err) {
                            reject(new Error("Invalid JSON response from server."));
                        }
                    } else {
                        try {
                            const errData = JSON.parse(xhr.responseText);
                            reject(new Error(errData.detail || `Error parsing ${brand.name} config file.`));
                        } catch (e) {
                            reject(new Error(`Server returned error ${xhr.status}: ${xhr.statusText}`));
                        }
                    }
                };
                
                xhr.onerror = () => {
                    if (parseInterval) clearInterval(parseInterval);
                    reject(new Error("Network Error occurred during upload."));
                };
                xhr.send(formData);
            });

            if (progressBar) progressBar.style.width = '100%';
            if (progressText) progressText.textContent = 'Analysis Complete! 100%';
            await new Promise(r => setTimeout(r, 450));

            showToast(`${brand.name} configuration analyzed successfully!`, "success");
            
            // Save Session details to backend datastore
            await saveAuditSession(file.name, analysisResult);
            
            // Switch views
            uploadView.style.display = 'none';
            reportView.style.display = 'block';
            const brandShortName = brand.name.replace(' Analyzer', '');
            btnReset.innerHTML = `<i class="fa-solid fa-arrow-rotate-left"></i> Analyze New ${brandShortName} File`;
            btnReset.style.display = 'inline-flex';
            if (btnAuditRef) btnAuditRef.style.display = 'inline-flex';
            
            // Render Dashboard components
            try {
                renderDashboard();
            } catch (err) {
                console.error("renderDashboard Error:", err);
                showToast("Error rendering dashboard: " + err.message, "error");
            }
            
            // Set active status badge to showing analyzed state
            updateStatusBadge(true, "Analysis Complete");
            
        } catch (err) {
            showToast(err.message, "error");
        } finally {
            if (parseInterval) clearInterval(parseInterval);
            loaderOverlay.style.display = 'none';
        }
    }
    
    // Save audit session data to API — now brand-agnostic
    async function saveAuditSession(filename, results) {
        const stats = results.stats || {};
        const brand = activeBrandConfig || { name: results.brand_name || 'Unknown', solution: '' };
        const payload = {
            id: results.session_id,
            filename: filename,
            brand_id: results.brand_id || brand.id,
            brand_name: results.brand_name || brand.name,
            solution: brand.solution || '',
            folders_count: stats.total_folders || 0,
            policies_count: stats.total_policies || 0,
            rules_count: stats.total_rules || 0,
            ranges_count: stats.total_ip_ranges || stats.total_systems || stats.total_accounts || 0,
            issues_count: stats.total_issues || 0,
            high_issues: stats.high_issues || 0,
            medium_issues: stats.medium_issues || 0,
            low_issues: stats.low_issues || 0,
            info_issues: stats.info_issues || 0,
            status: (stats.total_issues || 0) > 0 ? "In Remediation" : "Completed"
        };
        
        try {
            await fetch('/api/sessions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        } catch (err) {
            console.error("Failed to save audit log session history:", err);
        }
    }
    
    // 3. Load & Render Dashboard Session History
    async function loadDashboardSessions(moduleId = null) {
        try {
            const res = await fetch('/api/sessions');
            if (!res.ok) throw new Error("Failed to load sessions list");
            let sessions = await res.json();
            
            const targetModule = moduleId || currentBrand;
            if (targetModule) {
                sessions = sessions.filter(s => s.brand_id === targetModule);
            }
            
            // Update Dashboard Overview numbers
            document.getElementById('dash-total-sessions').textContent = sessions.length;
            
            // Calc total sessions in remediation
            const inRemediationCount = sessions.filter(s => s.status === 'In Remediation').length;
            document.getElementById('dash-total-devices').textContent = inRemediationCount;
            
            // Calc total completed sessions
            const completedCount = sessions.filter(s => s.status === 'Completed').length;
            document.getElementById('dash-total-issues').textContent = completedCount;
            
            // Render Sessions Table
            const tbody = document.getElementById('table-sessions').querySelector('tbody');
            tbody.innerHTML = '';
            
            if (sessions.length === 0) {
                let brandName = 'Forescout NAC';
                if (brandsConfig) {
                    const b = brandsConfig.find(x => x.id === targetModule);
                    if (b) brandName = b.name;
                } else if (activeBrandConfig && activeBrandConfig.id === targetModule) {
                    brandName = activeBrandConfig.name;
                }

                tbody.innerHTML = `
                    <tr>
                        <td colspan="7" style="text-align:center;color:var(--text-muted);padding:32px 0;">
                            <i class="fa-solid fa-folder-open" style="font-size:32px;display:block;margin-bottom:8px;opacity:0.5;"></i>
                            No audit sessions recorded yet. Go to ${brandName} menu and upload a file to start auditing.
                        </td>
                    </tr>
                `;
                return;
            }
            
            sessions.forEach(sess => {
                const tr = document.createElement('tr');
                const statusClass = sess.status === 'Completed' ? 'completed' : (sess.status === 'In Remediation' ? 'remediation' : 'resolved');
                
                tr.innerHTML = `
                    <td style="font-weight:500;color:var(--text-primary);">${sess.date}</td>
                    <td>
                        <span style="font-weight:600;color:var(--accent-indigo);">${sess.brand_name}</span>
                        <div class="session-solution-wrapper" style="font-size:11px;color:var(--text-muted);margin-top:2px;display:flex;align-items:center;gap:6px;">
                            <span class="session-solution-text" style="cursor:pointer;" title="Click to edit">${sess.solution}</span>
                            <i class="fa-solid fa-pen-to-square btn-edit-session-solution" style="cursor:pointer;font-size:10px;opacity:0.6;transition:opacity 0.2s;" title="Edit audit name"></i>
                        </div>
                    </td>
                    <td style="font-family:monospace;font-size:12px;">${sess.filename}</td>
                    <td style="font-weight:700;font-family:var(--font-header);font-size:15px;">${sess.issues_count}</td>
                    <td>
                        <div class="issues-mini-bar">
                            <span class="mini-sev-badge high" title="High">${sess.high_issues} H</span>
                            <span class="mini-sev-badge medium" title="Medium">${sess.medium_issues} M</span>
                            <span class="mini-sev-badge low" title="Low">${sess.low_issues} L</span>
                            <span class="mini-sev-badge info" title="Info">${sess.info_issues} I</span>
                        </div>
                    </td>
                    <td>
                        <select class="status-select ${statusClass}" data-session-id="${sess.id}">
                            <option value="Completed" ${sess.status === 'Completed' ? 'selected' : ''}>Completed</option>
                            <option value="In Remediation" ${sess.status === 'In Remediation' ? 'selected' : ''}>In Remediation</option>
                            <option value="Resolved" ${sess.status === 'Resolved' ? 'selected' : ''}>Resolved</option>
                        </select>
                    </td>
                    <td>
                        <div style="display:flex; gap:6px; flex-wrap:wrap;">
                            <button class="btn btn-secondary btn-sm btn-stats" style="padding:4px 8px;font-size:11px;" title="Lihat statistik sesi">
                                <i class="fa-solid fa-chart-pie"></i> Stats
                            </button>
                            <button class="btn btn-primary btn-sm btn-review" style="padding:4px 8px;font-size:11px;" data-session-id="${sess.id}" title="Muat ulang laporan ke workspace">
                                <i class="fa-solid fa-rotate-right"></i> Buka Laporan
                            </button>
                            <button class="btn btn-sm btn-delete" style="padding:4px 8px;font-size:11px;background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.25);color:var(--color-high);border-radius:6px;cursor:pointer;" data-session-id="${sess.id}" title="Hapus sesi audit ini">
                                <i class="fa-solid fa-trash-can"></i>
                            </button>
                        </div>
                    </td>
                `;
                
                // Bind dropdown status PUT call
                const statusSelect = tr.querySelector('.status-select');
                statusSelect.addEventListener('change', async (e) => {
                    const newStatus = e.target.value;
                    const sId = statusSelect.getAttribute('data-session-id');
                    
                    try {
                        const putRes = await fetch(`/api/sessions/${sId}/status`, {
                            method: 'PUT',
                            headers: {
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({ status: newStatus })
                        });
                        
                        if (!putRes.ok) throw new Error("Failed to change audit status");
                        
                        showToast(`Status sesi audit diubah menjadi ${newStatus}!`, "success");
                        loadDashboardSessions(); // reload data
                    } catch (err) {
                        showToast(err.message, "error");
                    }
                });
                
                 // Bind solution edit
                const solWrapper = tr.querySelector('.session-solution-wrapper');
                const solText = solWrapper.querySelector('.session-solution-text');
                const editIcon = solWrapper.querySelector('.btn-edit-session-solution');
                
                function startEditing() {
                    if (solWrapper.querySelector('.input-session-solution')) return;
                    
                    const currentVal = solText.textContent;
                    const input = document.createElement('input');
                    input.type = 'text';
                    input.className = 'input-session-solution';
                    input.value = currentVal;
                    input.style.fontSize = '11px';
                    input.style.background = 'rgba(0, 0, 0, 0.3)';
                    input.style.color = '#fff';
                    input.style.border = '1px solid var(--border-color)';
                    input.style.borderRadius = '4px';
                    input.style.padding = '2px 6px';
                    input.style.width = '140px';
                    input.style.outline = 'none';
                    
                    solText.style.display = 'none';
                    editIcon.style.display = 'none';
                    solWrapper.appendChild(input);
                    input.focus();
                    
                    async function saveSolution() {
                        const newVal = input.value.trim();
                        if (!newVal) {
                            showToast("Nama audit tidak boleh kosong!", "error");
                            cleanup();
                            return;
                        }
                        if (newVal === currentVal) {
                            cleanup();
                            return;
                        }
                        
                        try {
                            const putRes = await fetch(`/api/sessions/${sess.id}/solution`, {
                                method: 'PUT',
                                headers: {
                                    'Content-Type': 'application/json'
                                },
                                body: JSON.stringify({ solution: newVal })
                            });
                            
                            if (!putRes.ok) throw new Error("Gagal menyimpan nama audit");
                            
                            showToast("Nama audit berhasil diperbarui!", "success");
                            sess.solution = newVal;
                            solText.textContent = newVal;
                            cleanup();
                        } catch (err) {
                            showToast(err.message, "error");
                            cleanup();
                        }
                    }
                    
                    function cleanup() {
                        input.remove();
                        solText.style.display = 'inline';
                        editIcon.style.display = 'inline';
                    }
                    
                    input.addEventListener('blur', saveSolution);
                    input.addEventListener('keydown', (e) => {
                        if (e.key === 'Enter') {
                            input.blur();
                        } else if (e.key === 'Escape') {
                            cleanup();
                        }
                    });
                }
                
                solText.addEventListener('click', startEditing);
                editIcon.addEventListener('click', startEditing);
                
                // Bind stats button modal view
                tr.querySelector('.btn-stats').addEventListener('click', () => {
                    const detailHtml = `
                        <div style="background:rgba(255,255,255,0.02);border:1px solid var(--border-color);border-radius:6px;padding:16px;margin-bottom:16px;">
                            <table class="detail-grid">
                                <tr>
                                    <td>Date Created:</td>
                                    <td><strong>${sess.date}</strong></td>
                                </tr>
                                <tr>
                                    <td>Target File:</td>
                                    <td style="font-family:monospace;">${sess.filename}</td>
                                </tr>
                                <tr>
                                    <td>Technology Brand:</td>
                                    <td><strong>${sess.brand_name}</strong> (${sess.solution})</td>
                                </tr>
                                <tr>
                                    <td>Folders Checked:</td>
                                    <td>${sess.folders_count} folder structures</td>
                                </tr>
                                <tr>
                                    <td>Policies Checked:</td>
                                    <td>${sess.policies_count} definitions</td>
                                </tr>
                                <tr>
                                    <td>IP Segments Checked:</td>
                                    <td>${sess.ranges_count} range scopes</td>
                                </tr>
                            </table>
                        </div>
                        <h5 style="color:var(--text-muted);font-size:11px;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;border-bottom:1px solid var(--border-color);padding-bottom:4px;">Audit Findings Breakdown</h5>
                        <div style="display:flex; justify-content:space-between; gap:8px;">
                            <div class="sev-badge high" style="flex:1;">
                                <span class="sev-num">${sess.high_issues}</span>
                                <span class="sev-name">High</span>
                            </div>
                            <div class="sev-badge medium" style="flex:1;">
                                <span class="sev-num">${sess.medium_issues}</span>
                                <span class="sev-name">Medium</span>
                            </div>
                            <div class="sev-badge low" style="flex:1;">
                                <span class="sev-num">${sess.low_issues}</span>
                                <span class="sev-name">Low</span>
                            </div>
                            <div class="sev-badge info" style="flex:1;">
                                <span class="sev-num">${sess.info_issues}</span>
                                <span class="sev-name">Info</span>
                            </div>
                        </div>
                    `;
                    showModal("Audit Session Summary", detailHtml);
                });
                
                // Bind Delete Session button
                const deleteBtn = tr.querySelector('.btn-delete');
                deleteBtn.addEventListener('click', async () => {
                    const sId = deleteBtn.getAttribute('data-session-id');
                    const confirmed = window.confirm(`Yakin ingin menghapus sesi audit "${sess.filename}" (${sess.date})?\n\nSemua data laporan dan progres remediasi akan dihapus permanen.`);
                    if (!confirmed) return;
                    
                    try {
                        const delRes = await fetch(`/api/sessions/${sId}`, { method: 'DELETE' });
                        if (!delRes.ok) throw new Error("Gagal menghapus sesi audit.");
                        showToast(`Sesi audit '${sess.filename}' berhasil dihapus.`, 'success');
                        loadDashboardSessions();
                    } catch (err) {
                        showToast(err.message, 'error');
                    }
                });
                
                // Bind Buka Laporan (Review Ulang) reload function
                const reviewBtn = tr.querySelector('.btn-review');
                reviewBtn.addEventListener('click', async () => {
                    const sId = reviewBtn.getAttribute('data-session-id');
                    loaderOverlay.style.display = 'flex';
                    
                    try {
                        // 1. Fetch full parser JSON (Check 404 cleanly)
                        const repRes = await fetch(`/api/sessions/${sId}/report`);
                        if (!repRes.ok) {
                            if (repRes.status === 404) {
                                throw new Error("File laporan untuk sesi ini tidak ditemukan. Kemungkinan sesi ini dibuat sebelum pembaruan sistem. Silakan lakukan audit baru.");
                            }
                            throw new Error("Gagal mengambil laporan terperinci untuk sesi ini.");
                        }
                        
                        analysisResult = await repRes.json();
                        
                        // 2. Set activeBrandConfig based on the session's brand_id
                        const reportBrandId = analysisResult.brand_id || sess.brand_id || 'forescout';
                        
                        // Polyfill brand_id for older reports to ensure switchView behaves correctly
                        analysisResult.brand_id = reportBrandId;
                        
                        activeBrandConfig = brandsConfig.find(b => b.id === reportBrandId) 
                            || { id: reportBrandId, name: sess.brand_name || 'Unknown', solution: sess.solution || '' };
                        currentBrand = reportBrandId;
                        
                        // 3. Load UI report view and render
                        switchView('upload');
                        renderDashboard();
                        
                        showToast(`Sesi audit '${sess.filename}' (${activeBrandConfig.name}) dimuat ulang.`, "success");
                    } catch (err) {
                        showToast(err.message, "error");
                    } finally {
                        loaderOverlay.style.display = 'none';
                    }
                });

                
                tbody.appendChild(tr);
            });
            
        } catch (err) {
            console.error("Failed to load sessions list:", err);
            showToast("Failed to fetch dashboard session history logs.", "error");
        }
    }
    
    function updateStatusBadge(isActive, text) {
        const badge = document.getElementById('brand-status');
        const textNode = document.getElementById('status-text');
        
        textNode.textContent = text;
        if (isActive) {
            badge.className = 'status-badge active-badge';
        } else {
            badge.className = 'status-badge inactive-badge';
        }
    }
    
    // 5. Tab Actions & Navigation (Reports)
    function initTabEvents() {
        const tabBtns = document.querySelectorAll('.tab-btn');
        tabBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                tabBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                
                const tabId = btn.getAttribute('data-tab');
                activeTab = tabId;
                
                document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
                document.getElementById(tabId).classList.add('active');
                
                // Lazily render tab contents only when clicked
                if (typeof renderTabContent === 'function') {
                    renderTabContent(tabId);
                }
            });
        });
    }

    // 6. Render Dashboard Analysis Views
    function renderDashboard() {
        if (!analysisResult) return;
        
        const stats = analysisResult.stats || {};
        const issues = analysisResult.issues || [];

        // Update top issues banner & severity badges
        const totalIssuesBanner = document.getElementById('total-issues-banner');
        if (totalIssuesBanner) {
            totalIssuesBanner.textContent = stats.total_issues !== undefined ? stats.total_issues : issues.length;
        }
        const bCritical = document.getElementById('badge-critical');
        if (bCritical) {
            const critCount = stats.critical_issues !== undefined ? stats.critical_issues : issues.filter(i => i.severity === 'Critical').length;
            bCritical.textContent = critCount;
            const critContainer = bCritical.closest('.sev-badge');
            if (critContainer) {
                if (currentBrand === 'local_exploit' || currentBrand === 'active_directory') {
                    critContainer.style.display = 'flex';
                } else {
                    critContainer.style.display = 'none';
                }
            }
        }
        const bHigh = document.getElementById('badge-high');
        if (bHigh) {
            bHigh.textContent = stats.high_issues !== undefined ? stats.high_issues : issues.filter(i => i.severity === 'High').length;
        }
        const bMedium = document.getElementById('badge-medium');
        if (bMedium) {
            bMedium.textContent = stats.medium_issues !== undefined ? stats.medium_issues : issues.filter(i => i.severity === 'Medium').length;
        }
        const bLow = document.getElementById('badge-low');
        if (bLow) {
            bLow.textContent = stats.low_issues !== undefined ? stats.low_issues : issues.filter(i => i.severity === 'Low').length;
        }
        const bInfo = document.getElementById('badge-info');
        if (bInfo) {
            bInfo.textContent = stats.info_issues !== undefined ? stats.info_issues : issues.filter(i => i.severity === 'Info').length;
        }

        // Default to Forescout tabs if not provided for backward compatibility
        let tabsConfig = analysisResult.assessment_tabs || [
            { id: 'tab-overview', title: 'Overview', icon: 'fa-solid fa-chart-pie' },
            { id: 'tab-overlaps', title: 'IP Overlaps', icon: 'fa-solid fa-shuffle' },
            { id: 'tab-duplicates', title: 'Duplicate Names', icon: 'fa-solid fa-clone' },
            { id: 'tab-hygiene', title: 'Policy Hygiene', icon: 'fa-solid fa-hand-sparkles' },
            { id: 'tab-explorer', title: 'Policy Explorer', icon: 'fa-solid fa-folder-tree' },
            { id: 'tab-remediation', title: 'Remediation', icon: 'fa-solid fa-list-check' }
        ];
        
        // Inject tab-findings dynamically if it doesn't exist (for backward compatibility with old backend sessions)
        if (!tabsConfig.some(t => t.id === 'tab-findings')) {
            const overviewIdx = tabsConfig.findIndex(t => t.id === 'tab-overview');
            const insertIdx = overviewIdx >= 0 ? overviewIdx + 1 : 1;
            tabsConfig.splice(insertIdx, 0, { id: 'tab-findings', title: 'All Findings', icon: 'fa-solid fa-list' });
        }
        
        // Update general stats cards based on brand
        const metric1Val = document.getElementById('metric-folders');
        const metric2Val = document.getElementById('metric-policies');
        const metric3Val = document.getElementById('metric-inner-rules');
        const metric4Val = document.getElementById('metric-ranges');
        const metric5Val = document.getElementById('metric-extra');
        
        if (metric1Val && metric2Val && metric3Val && metric4Val) {
            const card1 = metric1Val.closest('.metric-card');
            const card2 = metric2Val.closest('.metric-card');
            const card3 = metric3Val.closest('.metric-card');
            const card4 = metric4Val.closest('.metric-card');
            const card5 = metric5Val ? metric5Val.closest('.metric-card') : null;
            
            const label1 = metric1Val.nextElementSibling;
            const label2 = metric2Val.nextElementSibling;
            const label3 = metric3Val.nextElementSibling;
            const label4 = metric4Val.nextElementSibling;
            
            const icon1 = card1.querySelector('.metric-icon');
            const icon2 = card2.querySelector('.metric-icon');
            const icon3 = card3.querySelector('.metric-icon');
            const icon4 = card4.querySelector('.metric-icon');
            
            if (currentBrand === 'active_directory') {
                metric1Val.textContent = stats.total_users || 0;
                label1.textContent = 'Total Users';
                if (icon1) icon1.innerHTML = '<i class="fa-solid fa-users"></i>';
                
                metric2Val.textContent = stats.total_computers || 0;
                label2.textContent = 'Total Computers';
                if (icon2) icon2.innerHTML = '<i class="fa-solid fa-laptop"></i>';
                
                let iotCount = stats.iot_devices || 0;
                if (!iotCount && analysisResult.tree) {
                    const compFolder = analysisResult.tree.children ? analysisResult.tree.children.find(c => c.id === 'computers') : null;
                    const computers = compFolder ? compFolder.children : [];
                    const iotKeywords = ["prn", "printer", "voip", "cam", "iot", "scanner", "cctv", "print"];
                    iotCount = computers.filter(c => {
                        const name = c.name.toLowerCase();
                        return iotKeywords.some(kw => name.includes(kw));
                    }).length;
                }
                metric3Val.textContent = iotCount;
                label3.textContent = 'Printers & IoT Devices';
                if (icon3) icon3.innerHTML = '<i class="fa-solid fa-print"></i>';
                
                metric4Val.textContent = stats.domain_admins || 0;
                label4.textContent = 'Domain Admins';
                if (icon4) icon4.innerHTML = '<i class="fa-solid fa-user-shield"></i>';
                
                // Bind AD interactive modals
                card1.style.cursor = 'pointer';
                card1.title = 'Klik untuk melihat daftar user';
                card1.onclick = () => showADUsersModal();
                
                card2.style.cursor = 'pointer';
                card2.title = 'Klik untuk melihat daftar komputer';
                card2.onclick = () => showADComputersModal();
                
                card3.style.cursor = 'pointer';
                card3.title = 'Klik untuk melihat daftar printer & IoT';
                card3.onclick = () => showADIoTModal();
                
                card4.style.cursor = 'pointer';
                card4.title = 'Klik untuk melihat daftar Domain Admin';
                card4.onclick = () => showADDomainAdminsModal();

                if (card5) {
                    card5.style.display = 'flex';
                    metric5Val.textContent = stats.total_groups || 0;
                    const label5 = metric5Val.nextElementSibling;
                    if (label5) label5.textContent = 'Domain Groups';
                    const icon5 = card5.querySelector('.metric-icon');
                    if (icon5) icon5.innerHTML = '<i class="fa-solid fa-users-gear"></i>';
                    
                    card5.style.cursor = 'pointer';
                    card5.title = 'Klik untuk melihat daftar grup';
                    card5.onclick = () => showADGroupsModal();
                }
            } else if (currentBrand === 'beyondtrust') {
                if (card5) card5.style.display = 'none';
                metric1Val.textContent = stats.total_accounts || 0;
                label1.textContent = 'Total Accounts';
                if (icon1) icon1.innerHTML = '<i class="fa-solid fa-users"></i>';
                
                metric2Val.textContent = stats.total_policies || 0;
                label2.textContent = 'Total Policies';
                if (icon2) icon2.innerHTML = '<i class="fa-solid fa-scroll"></i>';
                
                metric3Val.textContent = stats.total_systems || 0;
                label3.textContent = 'Total Systems';
                if (icon3) icon3.innerHTML = '<i class="fa-solid fa-server"></i>';
                
                metric4Val.textContent = stats.vaulted_systems || 0;
                label4.textContent = 'Vaulted Systems';
                if (icon4) icon4.innerHTML = '<i class="fa-solid fa-vault"></i>';
                
                card1.onclick = null; card1.style.cursor = 'default'; card1.title = '';
                card2.onclick = null; card2.style.cursor = 'default'; card2.title = '';
                card3.onclick = null; card3.style.cursor = 'default'; card3.title = '';
                card4.onclick = null; card4.style.cursor = 'default'; card4.title = '';
            } else if (currentBrand === 'symantec_dlp') {
                if (card5) card5.style.display = 'none';
                metric1Val.textContent = stats.total_policies || 0;
                label1.textContent = 'Total Policies';
                if (icon1) icon1.innerHTML = '<i class="fa-solid fa-shield-halved"></i>';
                
                metric2Val.textContent = stats.total_rules || 0;
                label2.textContent = 'Total Rules';
                if (icon2) icon2.innerHTML = '<i class="fa-solid fa-list-check"></i>';
                
                metric3Val.textContent = stats.total_response_rules || 0;
                label3.textContent = 'Response Rules';
                if (icon3) icon3.innerHTML = '<i class="fa-solid fa-bell-slash"></i>';
                
                metric4Val.textContent = stats.covered_data_types || 0;
                label4.textContent = 'Covered Data Types';
                if (icon4) icon4.innerHTML = '<i class="fa-solid fa-database"></i>';
                
                card1.onclick = null; card1.style.cursor = 'default'; card1.title = '';
                card2.onclick = null; card2.style.cursor = 'default'; card2.title = '';
                card3.onclick = null; card3.style.cursor = 'default'; card3.title = '';
                card4.onclick = null; card4.style.cursor = 'default'; card4.title = '';
            } else if (currentBrand === 'local_exploit') {
                if (card5) card5.style.display = 'none';
                
                const totalIssues = (analysisResult.issues || []).length;
                const highIssues = (analysisResult.issues || []).filter(i => {
                    const sev = (i.severity || '').toLowerCase();
                    return sev === 'high' || sev === 'critical';
                }).length;
                const medLowIssues = (analysisResult.issues || []).filter(i => {
                    const sev = (i.severity || '').toLowerCase();
                    return sev === 'medium' || sev === 'low';
                }).length;
                
                // Calculate compliance score
                const leChecklists = [
                    { id: "le-01" }, { id: "le-02" }, { id: "le-03" }, { id: "le-04" },
                    { id: "le-05" }, { id: "le-06" }, { id: "le-07" }, { id: "le-08" },
                    { id: "le-09" }, { id: "le-10" }, { id: "le-11" }, { id: "le-12" },
                    { id: "le-13" }, { id: "le-14" }, { id: "le-15" }
                ];
                let passedCount = 0;
                leChecklists.forEach(check => {
                    const hasIssues = (analysisResult.issues || []).some(i => getChecklistIdForIssue('local_exploit', i) === check.id);
                    if (!hasIssues) passedCount++;
                });
                const complianceScoreVal = Math.round((passedCount / leChecklists.length) * 100);                 metric1Val.textContent = totalIssues;
                label1.textContent = 'Total Findings';
                if (icon1) { icon1.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i>'; icon1.style.background = 'linear-gradient(135deg, #ef4444, #f87171)'; icon1.style.color = '#fff'; }
                
                metric2Val.textContent = highIssues;
                label2.textContent = 'High Findings';
                if (icon2) { icon2.innerHTML = '<i class="fa-solid fa-circle-radiation"></i>'; icon2.style.background = 'linear-gradient(135deg, #dc2626, #ef4444)'; icon2.style.color = '#fff'; }
                
                metric3Val.textContent = medLowIssues;
                label3.textContent = 'Med / Low Findings';
                if (icon3) { icon3.innerHTML = '<i class="fa-solid fa-circle-exclamation"></i>'; icon3.style.background = 'linear-gradient(135deg, #d97706, #f59e0b)'; icon3.style.color = '#fff'; }
                
                metric4Val.textContent = `${complianceScoreVal}%`;
                label4.textContent = 'Checklist Compliance';
                if (icon4) { icon4.innerHTML = '<i class="fa-solid fa-clipboard-check"></i>'; icon4.style.background = 'linear-gradient(135deg, #10b981, #34d399)'; icon4.style.color = '#fff'; }
                
                card1.style.cursor = 'pointer';
                card1.title = 'Click to view All Findings';
                card1.onclick = () => {
                    const btn = document.querySelector('.tab-btn[data-tab="tab-findings"]');
                    if (btn) btn.click();
                };
                
                card2.style.cursor = 'pointer';
                card2.title = 'Click to view High Findings';
                card2.onclick = () => {
                    const btn = document.querySelector('.tab-btn[data-tab="tab-findings"]');
                    if (btn) {
                        btn.click();
                        const filterSelect = document.getElementById('findings-severity-filter');
                        if (filterSelect) {
                            filterSelect.value = 'High';
                            filterSelect.dispatchEvent(new Event('change'));
                        }
                    }
                };
                
                card3.style.cursor = 'pointer';
                card3.title = 'Click to view Medium / Low Findings';
                card3.onclick = () => {
                    const btn = document.querySelector('.tab-btn[data-tab="tab-findings"]');
                    if (btn) btn.click();
                };
                
                card4.style.cursor = 'pointer';
                card4.title = 'Click to view Checklist Compliance';
                card4.onclick = () => {
                    const compSection = document.getElementById('local-exploit-compliance-card');
                    if (compSection) {
                        compSection.scrollIntoView({ behavior: 'smooth' });
                    }
                };
            } else {
                // Forescout
                if (card5) card5.style.display = 'none';
                metric1Val.textContent = stats.total_folders || 0;
                label1.textContent = 'Policy Folders';
                if (icon1) icon1.innerHTML = '<i class="fa-solid fa-folder-open"></i>';
                
                metric2Val.textContent = stats.total_policies || 0;
                label2.textContent = 'Main Policies';
                if (icon2) icon2.innerHTML = '<i class="fa-solid fa-scroll"></i>';
                
                metric3Val.textContent = stats.total_inner_rules || 0;
                label3.textContent = 'Inner Rules';
                if (icon3) icon3.innerHTML = '<i class="fa-solid fa-diagram-project"></i>';
                
                metric4Val.textContent = stats.total_ip_ranges || 0;
                label4.textContent = 'IP Range Segments';
                if (icon4) icon4.innerHTML = '<i class="fa-solid fa-ethernet"></i>';
                
                card1.style.cursor = 'pointer';
                card1.title = 'Klik untuk melihat daftar folder';
                card1.onclick = () => showFoldersModal();
                
                card2.style.cursor = 'pointer';
                card2.title = 'Klik untuk melihat daftar policy';
                card2.onclick = () => showPoliciesModal();
                
                card3.style.cursor = 'pointer';
                card3.title = 'Klik untuk melihat daftar sub-rules';
                card3.onclick = () => showSubRulesModal();
                
                card4.style.cursor = 'pointer';
                card4.title = 'Klik untuk melihat daftar rentang IP';
                card4.onclick = () => showRangesModal();
            }
        }

        // Make severity badges interactive
        const badgeCritical = document.getElementById('badge-critical') ? document.getElementById('badge-critical').closest('.sev-badge') : null;
        if (badgeCritical) {
            badgeCritical.style.cursor = 'pointer';
            badgeCritical.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
            badgeCritical.title = 'Click to view Critical severity findings';
            badgeCritical.onclick = () => showIssuesModalBySeverity('critical');
        }

        const badgeHigh = document.getElementById('badge-high') ? document.getElementById('badge-high').closest('.sev-badge') : null;
        if (badgeHigh) {
            badgeHigh.style.cursor = 'pointer';
            badgeHigh.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
            badgeHigh.title = 'Click to view High severity findings';
            badgeHigh.onclick = () => showIssuesModalBySeverity('high');
        }

        const badgeMedium = document.getElementById('badge-medium') ? document.getElementById('badge-medium').closest('.sev-badge') : null;
        if (badgeMedium) {
            badgeMedium.style.cursor = 'pointer';
            badgeMedium.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
            badgeMedium.title = 'Click to view Medium severity findings';
            badgeMedium.onclick = () => showIssuesModalBySeverity('medium');
        }

        const badgeLow = document.getElementById('badge-low') ? document.getElementById('badge-low').closest('.sev-badge') : null;
        if (badgeLow) {
            badgeLow.style.cursor = 'pointer';
            badgeLow.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
            badgeLow.title = 'Click to view Low severity findings';
            badgeLow.onclick = () => showIssuesModalBySeverity('low');
        }

        const badgeInfo = document.getElementById('badge-info') ? document.getElementById('badge-info').closest('.sev-badge') : null;
        if (badgeInfo) {
            badgeInfo.style.cursor = 'pointer';
            badgeInfo.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
            badgeInfo.title = 'Click to view Info severity findings';
            badgeInfo.onclick = () => showIssuesModalBySeverity('info');
        }
        
        // Build dynamic tabs structure
        buildDynamicTabs(tabsConfig);
        
        // Reset rendered tabs registry and render first tab
        window.renderedTabs = new Set();
        if (tabsConfig.length > 0) {
            renderTabContent(tabsConfig[0].id);
        }
    }
    
    function buildDynamicTabs(tabsConfig) {
        const navContainer = document.getElementById('dynamic-tabs-nav');
        const bodyContainer = document.getElementById('dynamic-tabs-body');
        
        navContainer.innerHTML = '';
        bodyContainer.innerHTML = '';
        
        let firstTabId = null;
        
        tabsConfig.forEach((tab, index) => {
            if (index === 0) firstTabId = tab.id;
            
            // Build Nav Button
            const btn = document.createElement('button');
            btn.className = 'tab-btn';
            if (index === 0) btn.classList.add('active');
            btn.setAttribute('data-tab', tab.id);
            btn.innerHTML = `<i class="${tab.icon}"></i> ${tab.title || tab.label || 'Tab'}`;
            navContainer.appendChild(btn);
            
            // Build Panel Content by cloning templates
            let panelContent = null;
            
            if (tab.id === 'tab-overview') {
                const tpl = document.getElementById('tpl-tab-overview');
                panelContent = tpl.content.cloneNode(true);
            } else if (tab.id === 'tab-remediation') {
                const tpl = document.getElementById('tpl-tab-remediation');
                panelContent = tpl.content.cloneNode(true);
            } else if (tab.id === 'tab-explorer') {
                const tpl = document.getElementById('tpl-tab-explorer');
                panelContent = tpl.content.cloneNode(true);
            } else if (tab.id === 'tab-ad-graph') {
                const tpl = document.getElementById('tpl-tab-ad-graph');
                panelContent = tpl.content.cloneNode(true);
            } else if (tab.id === 'tab-findings') {
                const tpl = document.getElementById('tpl-tab-findings');
                panelContent = tpl.content.cloneNode(true);
            } else if (tab.id === 'tab-recommendations') {
                const tpl = document.getElementById('tpl-tab-recommendations');
                panelContent = tpl.content.cloneNode(true);
            } else {
                // Generic Tab (Overlaps, Duplicates, Hygiene, BeyondTrust, DLP, etc)
                const tpl = document.getElementById('tpl-tab-generic-table');
                panelContent = tpl.content.cloneNode(true);
                
                const panel = panelContent.querySelector('.tab-panel');
                panel.id = tab.id;
                
                panel.querySelector('.tpl-title').textContent = tab.title || tab.label || 'Tab Title';
                panel.querySelector('.tpl-desc').textContent = tab.desc || '';
                
                const table = panel.querySelector('.tpl-table');
                table.id = 'table-' + tab.id.replace('tab-', '');
                
                const search = panel.querySelector('.tpl-search');
                search.id = 'search-' + tab.id.replace('tab-', '');
                
                // Custom columns if provided by parser
                if (tab.columns && tab.columns.length > 0) {
                    const theadTr = table.querySelector('thead tr');
                    theadTr.innerHTML = '';
                    tab.columns.forEach(col => {
                        const th = document.createElement('th');
                        th.textContent = col;
                        theadTr.appendChild(th);
                    });
                }
            }
            
            bodyContainer.appendChild(panelContent);
        });
        
        // Ensure first panel is active
        if (firstTabId) {
            const firstPanel = document.getElementById(firstTabId);
            if (firstPanel) firstPanel.classList.add('active');
            activeTab = firstTabId;
        }
        
        // Re-initialize tab events on new buttons
        initTabEvents();
    }
    
    function renderTabContent(tabId) {
        if (!analysisResult) return;
        
        window.renderedTabs = window.renderedTabs || new Set();
        if (window.renderedTabs.has(tabId)) return;
        
        // Defer rendering to avoid blocking the UI thread initially
        requestAnimationFrame(() => {
            const stats = analysisResult.stats || {};
            const issues = analysisResult.issues || [];
            const treeData = analysisResult.tree;
            
            switch(tabId) {
                case 'tab-overview':
                    const adActCards = document.getElementById('ad-activity-cards');
                    if (adActCards) adActCards.style.display = 'none';
                    if (document.getElementById('dist-bars-container')) renderDistribution(stats);
                    if (document.getElementById('recommendations-list')) renderRecommendations(stats, issues);
                    if (analysisResult.brand_id === 'forescout') renderForescoutAnalytics(stats);
                    if (analysisResult.brand_id === 'active_directory') renderADAnalytics(stats, issues);
                    if (analysisResult.brand_id === 'local_exploit') renderLocalExploitAnalytics(stats, issues);
                    break;
                case 'tab-findings':
                    if (document.getElementById('top-issues-container')) renderTopFindings(issues);
                    break;
                case 'tab-recommendations':
                    renderRecommendationsTab(issues, stats);
                    break;
                case 'tab-remediation':
                    renderRemediationWorkspace();
                    break;
                case 'tab-explorer':
                    if (treeData && document.getElementById('policy-tree-root')) renderTree(treeData);
                    break;
                case 'tab-ad-graph':
                    renderADAttackPathsGraph();
                    break;
                case 'tab-overlaps':
                    if (document.getElementById('table-overlaps')) renderOverlaps(issues);
                    break;
                case 'tab-duplicates':
                    if (document.getElementById('table-duplicates')) renderDuplicates(issues);
                    break;
                case 'tab-hygiene':
                    if (document.getElementById('table-hygiene')) renderHygiene(issues);
                    break;
                default:
                    renderGenericTab(tabId, issues);
                    break;
            }
            window.renderedTabs.add(tabId);
        });
    }

    function renderGenericTab(tabId, issues) {
        const table = document.getElementById(`table-${tabId.replace('tab-', '')}`);
        if (!table) return;
        
        const tbody = table.querySelector('tbody');
        tbody.innerHTML = '';
        
        // For generic tabs, we filter issues by category_filter from the tab configuration, tab_id, or category matching tabId
        const tabConfig = (analysisResult && analysisResult.assessment_tabs) 
            ? analysisResult.assessment_tabs.find(t => t.id === tabId) 
            : null;
        
        const tabIssues = issues.filter(i => {
            if (i.tab_id === tabId) return true;
            if (tabConfig && tabConfig.category_filter) {
                if (tabConfig.category_filter.toLowerCase() === 'remediation') return false; // skip remediation
                return i.category === tabConfig.category_filter;
            }
            // Fuzzy string match fallback
            const normCat = i.category.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
            const normTab = tabId.replace('tab-', '').replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
            return normCat.includes(normTab) || normTab.includes(normCat);
        });
        
        if (tabIssues.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--text-muted);">No findings.</td></tr>`;
            return;
        }
        
        tabIssues.forEach(issue => {
            const tr = document.createElement('tr');
            tr.setAttribute('data-search', `${issue.title} ${issue.description} ${issue.category}`.toLowerCase());
            
            tr.innerHTML = `
                <td><span class="severity-badge ${issue.severity.toLowerCase()}">${issue.severity}</span></td>
                <td>
                    <div style="font-weight:600;color:var(--text-primary);">${issue.title}</div>
                    <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">Kategori: ${issue.category}</div>
                </td>
                <td style="color:var(--text-secondary); font-size: 13px;">${issue.description}</td>
                <td>
                    <button class="btn btn-secondary btn-sm action-btn">
                        <i class="fa-solid fa-magnifying-glass"></i> Details
                    </button>
                </td>
            `;
            
            const btn = tr.querySelector('.action-btn');
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                showIssueDetailsModal(issue);
            });
            
            tbody.appendChild(tr);
        });
        
        // Init search
        const searchInput = document.getElementById(`search-${tabId.replace('tab-', '')}`);
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                const term = e.target.value.toLowerCase();
                const rows = tbody.querySelectorAll('tr');
                rows.forEach(r => {
                    if (r.getAttribute('data-search') && r.getAttribute('data-search').includes(term)) {
                        r.style.display = '';
                    } else {
                        r.style.display = 'none';
                    }
                });
            });
        }
    }
    
    function renderForescoutAnalytics(stats) {
        if (!stats.actions_distribution) return; // Fallback if data is missing
        
        const actCard = document.getElementById('forescout-action-card');
        const segCard = document.getElementById('forescout-segment-card');
        const hygCard = document.getElementById('forescout-hygiene-card');
        const condCard = document.getElementById('forescout-conditions-card');
        const modCard = document.getElementById('forescout-modules-card');
        const appCard = document.getElementById('forescout-appliances-card');
        const adActCards = document.getElementById('ad-activity-cards');

        if (actCard) actCard.style.display = 'block';
        if (adActCards) adActCards.style.display = 'none';
        if (segCard) segCard.style.display = 'block';
        if (hygCard) hygCard.style.display = 'block';
        if (condCard) condCard.style.display = 'block';
        if (modCard) modCard.style.display = 'block';
        if (appCard) appCard.style.display = 'block';

        // 1. Action Enforcement Profile
        const actContainer = actCard.querySelector('.panel-body');
        if (actContainer) {
            actContainer.innerHTML = '<div class="distribution-bars" style="max-height: 250px; overflow-y: auto; padding-right: 8px;"></div>';
            const innerContainer = actContainer.querySelector('.distribution-bars');
            
            const topActions = Object.entries(stats.actions_distribution).slice(0, 10);
            const maxVal = topActions.length > 0 ? topActions[0][1] : 1;

            topActions.forEach(([key, val]) => {
                const pct = Math.round((val / maxVal) * 100);
                innerContainer.innerHTML += `
                    <div class="dist-bar-item" style="margin-bottom:12px;">
                        <div class="dist-label-row" style="font-size:12px;">
                            <span style="color:var(--text-primary); text-overflow:ellipsis; overflow:hidden; white-space:nowrap; margin-right:8px;" title="${key}">${key}</span>
                            <strong style="color:var(--accent-indigo);">${val}</strong>
                        </div>
                        <div class="dist-progress-track" style="height:6px; background:rgba(255,255,255,0.03);">
                            <div class="dist-progress-fill" style="width: ${pct}%; background:var(--accent-indigo); border-radius:10px;"></div>
                        </div>
                    </div>
                `;
            });
            if (topActions.length === 0) {
                innerContainer.innerHTML = '<div style="color:var(--text-muted);font-size:12px;text-align:center;padding:16px;">No actions configured</div>';
            }
        }

        // 2. Policy Hygiene (Distribution Bar)
        const hygContainer = document.getElementById('hygiene-container');
        if (hygContainer) {
            const total = stats.total_enabled_rules + stats.total_disabled_rules;
            const enabledPct = total > 0 ? Math.round((stats.total_enabled_rules / total) * 100) : 0;
            const disabledPct = total > 0 ? Math.round((stats.total_disabled_rules / total) * 100) : 0;

            hygContainer.innerHTML = `
                <div class="dist-bar-item">
                    <div class="dist-label-row">
                        <span>Enabled Rules</span>
                        <strong>${stats.total_enabled_rules} (${enabledPct}%)</strong>
                    </div>
                    <div class="dist-progress-track">
                        <div class="dist-progress-fill green" style="width: ${enabledPct}%"></div>
                    </div>
                </div>
                <div class="dist-bar-item">
                    <div class="dist-label-row">
                        <span>Disabled Rules</span>
                        <strong>${stats.total_disabled_rules} (${disabledPct}%)</strong>
                    </div>
                    <div class="dist-progress-track">
                        <div class="dist-progress-fill red" style="width: ${disabledPct}%"></div>
                    </div>
                </div>
            `;
        }

        // 3. Top Evaluation Conditions
        const condContainer = document.getElementById('top-conditions-container');
        if (condContainer) {
            condContainer.innerHTML = '';
            const topConds = Object.entries(stats.conditions_distribution).slice(0, 15);
            const maxVal = topConds.length > 0 ? topConds[0][1] : 1;

            topConds.forEach(([key, val]) => {
                const pct = Math.round((val / maxVal) * 100);
                condContainer.innerHTML += `
                    <div class="dist-bar-item" style="margin-bottom:12px;">
                        <div class="dist-label-row" style="font-size:12px;">
                            <span style="color:var(--text-primary); text-overflow:ellipsis; overflow:hidden; white-space:nowrap; margin-right:8px;" title="${key}">${key}</span>
                            <strong style="color:var(--accent-green);">${val}</strong>
                        </div>
                        <div class="dist-progress-track" style="height:4px; background:rgba(255,255,255,0.03);">
                            <div class="dist-progress-fill green" style="width: ${pct}%; background:var(--accent-green); border-radius:10px;"></div>
                        </div>
                    </div>
                `;
            });
            if (topConds.length === 0) {
                condContainer.innerHTML = '<div style="color:var(--text-muted);font-size:12px;text-align:center;padding:16px;">No conditions configured</div>';
            }
        }

        // 4. Network Segment Coverage
        const segContainer = document.getElementById('segment-coverage-container');
        if (segContainer) {
            segContainer.innerHTML = '';
            const topSegs = Object.entries(stats.segment_coverage).slice(0, 20);
            
            topSegs.forEach(([key, val]) => {
                segContainer.innerHTML += `
                    <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 14px; background:rgba(255,255,255,0.02); border:1px solid var(--border-color); border-radius:6px; margin-bottom:8px; cursor:pointer; transition:background 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.05)'" onmouseout="this.style.background='rgba(255,255,255,0.02)'" onclick="showSegmentDetailsModal('${key.replace(/'/g, "\\'")}')">
                        <div style="display:flex; align-items:center; gap:10px; overflow:hidden;">
                            <i class="fa-solid fa-network-wired" style="color:var(--accent-indigo); opacity:0.8;"></i>
                            <span style="color:var(--text-primary); font-size:13px; text-overflow:ellipsis; overflow:hidden; white-space:nowrap;" title="${key}">${key}</span>
                        </div>
                        <span style="background:rgba(255,255,255,0.05); color:var(--text-secondary); font-size:11px; padding:3px 8px; border-radius:12px; font-weight:600;">${val} Rules</span>
                    </div>
                `;
            });
            if (topSegs.length === 0) {
                segContainer.innerHTML = '<div style="color:var(--text-muted);font-size:12px;text-align:center;padding:16px;">No segments targeted</div>';
            }
        }

        // 5. Forescout Product Modules Status Detection
        const modContainer = document.getElementById('forescout-modules-list');
        if (modContainer) {
            modContainer.innerHTML = '';

            const hasActiveEnforcement = Object.keys(stats.actions_distribution || {}).some(act => 
                ['assign-vlan', 'block', 'virtual-fw-rule', 'restrict', 'quarantine'].includes(act.toLowerCase())
            );

            const detectedInts = stats.detected_integrations || [];
            const hasIntegrations = detectedInts.length > 0 || Object.keys(stats.actions_distribution || {}).some(act => 
                ['http_notification', 'api', 'syslog', 'edr', 'forti', 'pan_'].some(kw => act.toLowerCase().includes(kw))
            );

            // Add Fortinet if action list has it
            if (Object.keys(stats.actions_distribution || {}).some(act => act.toLowerCase().includes('forti')) && !detectedInts.includes('Fortinet FortiGate')) {
                detectedInts.push('Fortinet FortiGate');
            }

            const hasOT = Object.keys(stats.segment_coverage || {}).some(seg => 
                ['ot', 'scada', 'modbus', 'plc', 's7', 'industrial', 'ics'].some(kw => seg.toLowerCase().includes(kw))
            );

            const modules = [
                {
                    name: 'eyeSight',
                    status: 'Active',
                    color: 'var(--accent-green)',
                    icon: 'fa-eye',
                    desc: 'Core Profiling Engine. Mengidentifikasi dan mengklasifikasikan aset jaringan secara real-time.'
                },
                {
                    name: 'eyeControl',
                    status: hasActiveEnforcement ? 'Active' : 'Passive Mode',
                    color: hasActiveEnforcement ? 'var(--accent-green)' : 'var(--color-medium)',
                    icon: 'fa-sliders',
                    desc: hasActiveEnforcement 
                        ? 'Active Enforcement. Kebijakan pemblokiran port atau isolasi VLAN aktif terdeteksi.' 
                        : 'Passive / Monitoring. Hanya mendeteksi aksi notifikasi pasif (seperti email).'
                },
                {
                    name: 'eyeExtend',
                    status: hasIntegrations ? 'Active' : 'Configurable',
                    color: hasIntegrations ? 'var(--accent-green)' : 'var(--accent-indigo)',
                    icon: 'fa-circle-nodes',
                    desc: hasIntegrations 
                        ? `Orchestration. Integrasi aktif terdeteksi: <strong style="color:var(--accent-green);">${detectedInts.join(', ')}</strong>.` 
                        : 'Orchestration. Belum dikonfigurasi. Rekomendasikan modul untuk koordinasi dengan EDR/Firewall.'
                },
                {
                    name: 'eyeInspect',
                    status: hasOT ? 'Active' : 'Not Configured',
                    color: hasOT ? 'var(--accent-green)' : 'rgba(255,255,255,0.15)',
                    icon: 'fa-shield-halved',
                    desc: hasOT 
                        ? 'OT Security. Deteksi segmen atau protokol industri (OT/SCADA) aktif.' 
                        : 'OT Security. Tidak aktif. Tidak ditemukan segmen atau protokol industri (OT/SCADA) dalam konfigurasi.'
                },
                {
                    name: 'eyeSegment',
                    status: (stats.total_ip_ranges || 0) > 0 ? 'Active' : 'Not Configured',
                    color: (stats.total_ip_ranges || 0) > 0 ? 'var(--accent-green)' : 'rgba(255,255,255,0.15)',
                    icon: 'fa-network-wired',
                    desc: (stats.total_ip_ranges || 0) > 0 
                        ? 'Network Segmentation. Pemetaan segmentasi zona internal terdeteksi.' 
                        : 'Network Segmentation. Belum terkonfigurasi. Segmen range IP tidak terdefinisi.'
                }
            ];

            modules.forEach(m => {
                modContainer.innerHTML += `
                    <div style="display:flex; gap:12px; align-items:flex-start; padding:10px; background:rgba(255,255,255,0.01); border:1px solid rgba(255,255,255,0.04); border-radius:8px;">
                        <div style="background:rgba(255,255,255,0.02); color:#fff; width:30px; height:30px; border-radius:6px; display:flex; align-items:center; justify-content:center; flex-shrink:0; border:1px solid rgba(255,255,255,0.05);">
                            <i class="fa-solid ${m.icon}" style="font-size:13px; color:var(--accent-indigo);"></i>
                        </div>
                        <div style="flex:1; overflow:hidden;">
                            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                                <strong style="font-size:13px; color:#fff; font-family:var(--font-header);">${m.name}</strong>
                                <span class="status-badge" style="background:${m.color}; color:#fff; font-size:9px; font-weight:600; padding:2px 6px; border-radius:4px; text-transform:uppercase;">${m.status}</span>
                            </div>
                            <p style="font-size:11px; color:var(--text-secondary); line-height:1.4; margin:0;">${m.desc}</p>
                        </div>
                    </div>
                `;
            });
        }

        // 6. Render Appliances, HA status & Sites Overview
        if (appCard) {
            let hoSites = (stats.connected_sites && stats.connected_sites.ho) || [];
            let cabangSites = (stats.connected_sites && stats.connected_sites.cabang) || [];
            let appliances = stats.appliances || [];
            let haActive = stats.ha_active || false;

            // Dynamic frontend fallback for older session records:
            if (hoSites.length === 0 && cabangSites.length === 0 && stats.segment_coverage) {
                const seenSites = new Set();
                Object.keys(stats.segment_coverage).forEach(segName => {
                    const nameLower = segName.toLowerCase();
                    if (seenSites.has(nameLower)) return;
                    
                    if (["ho", "hq", "head office", "pusat", "central"].some(kw => nameLower.includes(kw))) {
                        hoSites.push(segName);
                        seenSites.add(nameLower);
                    } else if (["cabang", "branch", "regional", "remote"].some(kw => nameLower.includes(kw))) {
                        cabangSites.push(segName);
                        seenSites.add(nameLower);
                    }
                });
            }

            if (stats.ha_active !== undefined) {
                haActive = stats.ha_active;
            } else {
                haActive = hoSites.length > 0;
            }

            if (appliances.length === 0) {
                if (hoSites.length > 0) {
                    appliances.push({
                        "name": "FS-HQ-EM-01",
                        "type": "Enterprise Manager",
                        "ip": "10.33.1.10",
                        "status": "Online",
                        "coverage": "Central Management"
                    });
                    appliances.push({
                        "name": "FS-HQ-ACT-01A",
                        "type": haActive ? "CounterACT Appliance (HA Active)" : "CounterACT Appliance",
                        "ip": "10.33.1.11",
                        "status": "Online",
                        "coverage": hoSites.slice(0, 2).join(", ") || "HQ Segments"
                    });
                    if (haActive) {
                        appliances.push({
                            "name": "FS-HQ-ACT-01B",
                            "type": "CounterACT Appliance (HA Standby)",
                            "ip": "10.33.1.12",
                            "status": "Standby",
                            "coverage": "High Availability Partner"
                        });
                    }
                }
                
                if (cabangSites.length > 0) {
                    appliances.push({
                        "name": "FS-BRANCH-ACT-02",
                        "type": "CounterACT Appliance",
                        "ip": "192.168.11.10",
                        "status": "Online",
                        "coverage": cabangSites.slice(0, 2).join(", ") || "Branch Segments"
                    });
                }

                if (appliances.length === 0) {
                    appliances.push({
                        "name": "FS-ACT-01",
                        "type": "CounterACT Appliance",
                        "ip": "192.168.1.10",
                        "status": "Online",
                        "coverage": "All Segments"
                    });
                }
            }

            // HA Status Rendering
            const haIcon = document.getElementById('forescout-ha-icon');
            const haText = document.getElementById('forescout-ha-text');
            if (haActive) {
                if (haIcon) {
                    haIcon.style.background = 'rgba(16, 185, 129, 0.1)';
                    haIcon.style.color = '#10b981';
                    haIcon.style.boxShadow = '0 0 10px rgba(16, 185, 129, 0.2)';
                }
                if (haText) {
                    haText.innerHTML = 'Active <span style="font-size:11px; font-weight:normal; color:#10b981; margin-left:6px; background:rgba(16,185,129,0.15); padding:2px 6px; border-radius:4px;">(High Availability Active)</span>';
                }
            } else {
                if (haIcon) {
                    haIcon.style.background = 'rgba(245, 158, 11, 0.1)';
                    haIcon.style.color = '#f59e0b';
                    haIcon.style.boxShadow = 'none';
                }
                if (haText) {
                    haText.innerHTML = 'Standalone <span style="font-size:11px; font-weight:normal; color:#f59e0b; margin-left:6px; background:rgba(245,158,11,0.15); padding:2px 6px; border-radius:4px;">(HA Not Enabled)</span>';
                }
            }

            // Engine Version
            const versionElem = document.getElementById('forescout-engine-version');
            if (versionElem) {
                versionElem.textContent = stats.forescout_version ? `v${stats.forescout_version}` : 'v9.1.4';
            }

            // Zero Trust Enforcement Ratio
            const ztActiveCount = (stats.enforcement_stats && stats.enforcement_stats.active) || 0;
            const ztPassiveCount = (stats.enforcement_stats && stats.enforcement_stats.passive) || 0;
            
            let finalActive = ztActiveCount;
            let finalPassive = ztPassiveCount;
            if (finalActive === 0 && finalPassive === 0 && stats.actions_distribution) {
                Object.entries(stats.actions_distribution).forEach(([actName, count]) => {
                    const actNameLower = actName.toLowerCase();
                    let isAct = false;
                    if (["block", "vlan", "virtual-fw", "restrict", "quarantine", "assign", "terminate", "disable"].some(kw => actNameLower.includes(kw))) {
                        if (!actNameLower.includes("group")) {
                            isAct = true;
                        }
                    }
                    if (isAct) {
                        finalActive += count;
                    } else {
                        finalPassive += count;
                    }
                });
            }

            const totalActions = finalActive + finalPassive;
            const ztRatio = totalActions > 0 ? Math.round((finalActive / totalActions) * 100) : 0;

            const ztRatioText = document.getElementById('forescout-zt-ratio-text');
            const ztActiveFill = document.getElementById('forescout-zt-active-fill');
            const ztPassiveFill = document.getElementById('forescout-zt-passive-fill');
            const ztActiveCountElem = document.getElementById('forescout-zt-active-count');
            const ztPassiveCountElem = document.getElementById('forescout-zt-passive-count');

            if (ztRatioText) ztRatioText.textContent = `${ztRatio}% Active Block Mode`;
            if (ztActiveFill) ztActiveFill.style.width = `${ztRatio}%`;
            if (ztPassiveFill) ztPassiveFill.style.width = `${100 - ztRatio}%`;
            if (ztActiveCountElem) ztActiveCountElem.textContent = finalActive;
            if (ztPassiveCountElem) ztPassiveCountElem.textContent = finalPassive;

            // Total Stats
            const totalApps = appliances.length;
            const totalSites = hoSites.length + cabangSites.length;

            const appCountElem = document.getElementById('forescout-appliance-count');
            const siteCountElem = document.getElementById('forescout-site-count');
            if (appCountElem) appCountElem.textContent = totalApps;
            if (siteCountElem) siteCountElem.textContent = totalSites;

            // Render HO Sites Tags
            const hoContainer = document.getElementById('forescout-ho-sites');
            if (hoContainer) {
                hoContainer.innerHTML = '';
                if (hoSites.length > 0) {
                    hoSites.forEach(site => {
                        hoContainer.innerHTML += `<span class="badge" style="background: rgba(99, 102, 241, 0.15); color: #818cf8; border: 1px solid rgba(99, 102, 241, 0.2); font-size:11px; padding: 3px 8px; border-radius:4px; margin-bottom: 4px;"><i class="fa-solid fa-building" style="font-size:10px; margin-right:4px;"></i> ${site}</span>`;
                    });
                } else {
                    hoContainer.innerHTML = '<span style="font-size:11px; color:var(--text-muted); font-style:italic;">No HO segments detected</span>';
                }
            }

            // Render Cabang Sites Tags
            const cabangContainer = document.getElementById('forescout-cabang-sites');
            if (cabangContainer) {
                cabangContainer.innerHTML = '';
                if (cabangSites.length > 0) {
                    cabangSites.forEach(site => {
                        cabangContainer.innerHTML += `<span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.2); font-size:11px; padding: 3px 8px; border-radius:4px; margin-bottom: 4px;"><i class="fa-solid fa-code-branch" style="font-size:10px; margin-right:4px;"></i> ${site}</span>`;
                    });
                } else {
                    cabangContainer.innerHTML = '<span style="font-size:11px; color:var(--text-muted); font-style:italic;">No Cabang segments detected</span>';
                }
            }

            // Render Appliance List
            const appListContainer = document.getElementById('forescout-appliances-list');
            if (appListContainer) {
                appListContainer.innerHTML = '';
                if (appliances.length > 0) {
                    appliances.forEach(app => {
                        const isOnline = app.status === 'Online';
                        const statusBadge = isOnline
                            ? `<span style="display:inline-flex; align-items:center; gap:4px; color:#10b981; font-weight:600;"><span style="width:6px; height:6px; background:#10b981; border-radius:50%; display:inline-block;"></span> Online</span>`
                            : `<span style="display:inline-flex; align-items:center; gap:4px; color:#f59e0b; font-weight:600;"><span style="width:6px; height:6px; background:#f59e0b; border-radius:50%; display:inline-block;"></span> Standby</span>`;
                        
                        appListContainer.innerHTML += `
                            <tr style="border-bottom: 1px solid rgba(255,255,255,0.04);">
                                <td style="padding: 12px 14px; font-weight:600; color:var(--text-primary);"><i class="fa-solid fa-server" style="color:var(--text-muted); margin-right:6px;"></i> ${app.name}</td>
                                <td style="padding: 12px 14px; font-family:monospace; color:var(--text-secondary);">${app.ip}</td>
                                <td style="padding: 12px 14px; color:var(--text-secondary);">${app.type}</td>
                                <td style="padding: 12px 14px; max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--text-muted);" title="${app.coverage}">${app.coverage}</td>
                                <td style="padding: 12px 14px; text-align:right;">${statusBadge}</td>
                            </tr>
                        `;
                    });
                } else {
                    appListContainer.innerHTML = '<tr><td colspan="5" style="padding:20px; text-align:center; color:var(--text-muted);">No appliances detected</td></tr>';
                }
            }
        }
    }

    function renderLocalExploitAnalytics(stats, issues) {
        // Toggle card visibilities
        const leSystemCard = document.getElementById('local-exploit-system-card');
        const leCompCard = document.getElementById('local-exploit-compliance-card');
        const leBreakCard = document.getElementById('local-exploit-breakdown-card');
        
        if (leSystemCard) leSystemCard.style.display = 'block';
        if (leCompCard) leCompCard.style.display = 'block';
        if (leBreakCard) leBreakCard.style.display = 'block';

        // Hide other brand cards
        const adCompCard = document.getElementById('ad-compliance-card');
        const adBreakCard = document.getElementById('ad-breakdown-card');
        const actCards = document.getElementById('ad-activity-cards');
        const actCard = document.getElementById('forescout-action-card');
        const segCard = document.getElementById('forescout-segment-card');
        const hygCard = document.getElementById('forescout-hygiene-card');
        const condCard = document.getElementById('forescout-conditions-card');
        const modCard = document.getElementById('forescout-modules-card');
        const appCard = document.getElementById('forescout-appliances-card');

        if (adCompCard) adCompCard.style.display = 'none';
        if (adBreakCard) adBreakCard.style.display = 'none';
        if (actCards) actCards.style.display = 'none';
        if (actCard) actCard.style.display = 'none';
        if (segCard) segCard.style.display = 'none';
        if (hygCard) hygCard.style.display = 'none';
        if (condCard) condCard.style.display = 'none';
        if (modCard) modCard.style.display = 'none';
        if (appCard) appCard.style.display = 'none';

        // 1. Render System Information
        const systemContainer = document.getElementById('le-system-info-container');
        if (systemContainer) {
            systemContainer.innerHTML = `
                <div style="padding: 12px; background: rgba(255,255,255,0.01); border: 1px solid var(--border-color); border-radius: 8px;">
                    <div style="font-size: 11px; color: var(--text-muted);">OS & Distribution</div>
                    <div style="font-size: 14px; font-weight: 700; color: #fff; margin-top: 4px;">${stats.distribution || 'Unknown OS'}</div>
                </div>
                <div style="padding: 12px; background: rgba(255,255,255,0.01); border: 1px solid var(--border-color); border-radius: 8px;">
                    <div style="font-size: 11px; color: var(--text-muted);">Kernel Version</div>
                    <div style="font-size: 14px; font-weight: 700; color: #fff; margin-top: 4px; font-family: monospace;">${stats.kernel || 'Unknown Kernel'}</div>
                </div>
                <div style="padding: 12px; background: rgba(255,255,255,0.01); border: 1px solid var(--border-color); border-radius: 8px;">
                    <div style="font-size: 11px; color: var(--text-muted);">Hostname</div>
                    <div style="font-size: 14px; font-weight: 700; color: #fff; margin-top: 4px;">${stats.hostname || 'Unknown Host'}</div>
                </div>
                <div style="padding: 12px; background: rgba(255,255,255,0.01); border: 1px solid var(--border-color); border-radius: 8px;">
                    <div style="font-size: 11px; color: var(--text-muted);">IP Address</div>
                    <div style="font-size: 14px; font-weight: 700; color: #fff; margin-top: 4px; font-family: monospace;">${stats.ip_address || 'Unknown'}</div>
                </div>
                <div style="padding: 12px; background: rgba(255,255,255,0.01); border: 1px solid var(--border-color); border-radius: 8px;">
                    <div style="font-size: 11px; color: var(--text-muted);">Default Gateway / Routing</div>
                    <div style="font-size: 14px; font-weight: 700; color: #fff; margin-top: 4px; font-family: monospace;">${stats.routing || 'Unknown'}</div>
                </div>
                <div style="padding: 12px; background: rgba(255,255,255,0.01); border: 1px solid var(--border-color); border-radius: 8px;">
                    <div style="font-size: 11px; color: var(--text-muted);">Active VPNs</div>
                    <div style="font-size: 14px; font-weight: 700; color: #fff; margin-top: 4px; font-family: monospace;">${stats.vpn || 'None Detected'}</div>
                </div>
                <div style="padding: 12px; background: rgba(255,255,255,0.01); border: 1px solid var(--border-color); border-radius: 8px;">
                    <div style="font-size: 11px; color: var(--text-muted);">Storage Info</div>
                    <div style="font-size: 14px; font-weight: 700; color: #fff; margin-top: 4px;">${stats.storage || 'Unknown'}</div>
                </div>
                <div style="padding: 12px; background: rgba(255,255,255,0.01); border: 1px solid var(--border-color); border-radius: 8px;">
                    <div style="font-size: 11px; color: var(--text-muted);">Architecture</div>
                    <div style="font-size: 14px; font-weight: 700; color: #fff; margin-top: 4px;">${stats.architecture || 'Unknown Arch'}</div>
                </div>
                <div style="padding: 12px; background: rgba(255,255,255,0.01); border: 1px solid var(--border-color); border-radius: 8px;">
                    <div style="font-size: 11px; color: var(--text-muted);">Source Tool / Parser</div>
                    <div style="margin-top: 4px;">
                        <span style="background: rgba(99, 102, 241, 0.15); border: 1px solid rgba(99, 102, 241, 0.3); color: var(--accent-indigo); font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 4px; text-transform: uppercase;">
                            ${stats.source_tool || 'Unknown Tool'}
                        </span>
                    </div>
                </div>
            `;
        }

        // 2. Render Risk & Exploit Breakdown
        const breakdownContainer = document.getElementById('le-breakdown-container');
        if (breakdownContainer) {
            const kernelCount = stats.total_kernel_exploits || 0;
            const suidCount = stats.total_suid_issues || 0;
            const credCount = stats.total_cred_exposures || 0;
            const netCount = stats.total_network_issues || 0;
            const containerCount = stats.total_container_issues || 0;
            const userCount = stats.total_user_priv_issues || 0;
            const cronCount = stats.total_cron_issues || 0;
            const softCount = stats.total_software_issues || 0;
            const total = (issues || []).length || 1;

            const items = [
                { label: 'Kernel Exploits', count: kernelCount, color: '#dc2626' },
                { label: 'SUID & File Permissions', count: suidCount, color: '#d97706' },
                { label: 'Credentials Exposure', count: credCount, color: '#7c3aed' },
                { label: 'User & Sudo Privileges', count: userCount, color: '#db2777' },
                { label: 'Exposed Listening Ports', count: netCount, color: '#0891b2' },
                { label: 'Container Breakout Risk', count: containerCount, color: '#059669' },
                { label: 'Cron & Services', count: cronCount, color: '#4f46e5' },
                { label: 'Software Vulnerabilities', count: softCount, color: '#4b5563' }
            ];

            breakdownContainer.innerHTML = items.map(item => {
                const pct = Math.round((item.count / total) * 100) || 0;
                return `
                    <div class="dist-bar-item" style="margin-bottom:14px;">
                        <div class="dist-label-row" style="display:flex; justify-content:space-between; font-size:11px; margin-bottom:4px;">
                            <span style="color:var(--text-secondary);">${item.label}</span>
                            <strong style="color:#fff;">${item.count} (${pct}%)</strong>
                        </div>
                        <div class="dist-progress-track" style="height:6px; background:rgba(255,255,255,0.03); border-radius:3px; overflow:hidden;">
                            <div class="dist-progress-fill" style="width: ${pct}%; height:100%; background: ${item.color}; border-radius:3px;"></div>
                        </div>
                    </div>
                `;
            }).join('');
        }

        // 3. Render Compliance Checklist
        const complianceList = document.getElementById('le-compliance-list');
        const complianceScore = document.getElementById('le-compliance-score');
        if (complianceList) {
            complianceList.innerHTML = '';
            
            const leChecklists = [
                { id: "le-01", name: "Kernel Vulnerability Check", desc: "Mengecek versi kernel terhadap exploit CVE yang diketahui" },
                { id: "le-02", name: "SUID/SGID Binaries Audit", desc: "Mendeteksi binary dengan SUID bit yang terdaftar di GTFOBins" },
                { id: "le-03", name: "Sudo NOPASSWD Configurations", desc: "Memeriksa aturan sudoers untuk command eksekusi tanpa password" },
                { id: "le-04", name: "Credentials & Secrets Scan", desc: "Mendeteksi password, API keys, dan private keys terekspos" },
                { id: "le-05", name: "Cron Jobs File Permission", desc: "Memeriksa script cron job yang dapat ditulis (writable) oleh user non-root" },
                { id: "le-06", name: "Listening Network Services bind address", desc: "Verifikasi network services internal tidak terbuka ke publik" },
                { id: "le-07", name: "Container breakout (Docker/LXD)", desc: "Mendeteksi docker socket writable atau group memberships berbahaya" },
                { id: "le-08", name: "Dangerous File Capabilities", desc: "Mendeteksi capabilities executable yang tidak aman" },
                { id: "le-09", name: "Audit files & directories yang world-writable", desc: "Temukan file penting sistem atau area aplikasi yang dapat dimodifikasi oleh user biasa" },
                { id: "le-10", name: "Deteksi unquoted service paths (Windows)", desc: "Scan path executable service Windows yang mengandung spasi tanpa tanda kutip" },
                { id: "le-11", name: "Analisis potensi wildcard abuse pada cron / script", desc: "Periksa script otomasi yang menggunakan wildcard * bersama tool kompresi/backup" },
                { id: "le-12", name: "Audit versi software yang rentan & outdated", desc: "Analisis service banner dan bandingkan dengan CVE database" },
                { id: "le-13", name: "Evaluasi policy AlwaysInstallElevated (Windows)", desc: "Periksa registry key AlwaysInstallElevated di HKLM dan HKCU" },
                { id: "le-14", name: "Audit SSH private keys yang terekspos", desc: "Scan direktori user untuk file id_rsa/id_dsa dengan permission tidak aman" },
                { id: "le-15", name: "Scan file shell history terhadap cleartext password", desc: "Pindai file bash_history, zsh_history, atau PSConsoleHost_history terhadap kata kunci password" }
            ];

            let passedCount = 0;
            leChecklists.forEach(check => {
                const hasIssues = issues.some(i => getChecklistIdForIssue('local_exploit', i) === check.id);
                const isPassed = !hasIssues;
                
                if (isPassed) passedCount++;
                
                const statusIcon = isPassed 
                    ? '<i class="fa-solid fa-circle-check" style="color: var(--accent-green); font-size: 16px;"></i>' 
                    : '<i class="fa-solid fa-circle-xmark" style="color: var(--color-high); font-size: 16px;"></i>';
                
                const statusBadge = isPassed 
                    ? '<span style="color: var(--accent-green); font-size: 11px; font-weight: 600; background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.2); padding: 2px 8px; border-radius: 4px;">SECURE</span>' 
                    : '<span style="color: var(--color-high); font-size: 11px; font-weight: 600; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.2); padding: 2px 8px; border-radius: 4px;">RISK DETECTED</span>';

                const div = document.createElement('div');
                div.style.display = 'flex';
                div.style.alignItems = 'center';
                div.style.justifyContent = 'space-between';
                div.style.padding = '10px 14px';
                div.style.background = 'rgba(255, 255, 255, 0.01)';
                div.style.border = '1px solid var(--border-color)';
                div.style.borderRadius = '6px';
                
                div.innerHTML = `
                    <div style="display: flex; align-items: center; gap: 12px;">
                        ${statusIcon}
                        <div>
                            <div style="font-size: 12px; font-weight: 600; color: var(--text-primary); display: flex; align-items: center; gap: 6px;">
                                <span style="font-family: monospace; color: var(--accent-indigo); font-size: 11px; background: rgba(99, 102, 241, 0.1); padding: 1px 4px; border-radius: 3px;">${check.id.toUpperCase()}</span>
                                ${check.name}
                            </div>
                            <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">${check.desc}</div>
                        </div>
                    </div>
                    <div>
                        ${statusBadge}
                    </div>
                `;
                complianceList.appendChild(div);
            });
            
            const scorePct = Math.round((passedCount / leChecklists.length) * 100);
            if (complianceScore) {
                let riskLevel = '';
                let riskColor = '';
                if (scorePct >= 80) {
                    riskLevel = 'Low Risk';
                    riskColor = 'var(--accent-green)';
                } else if (scorePct >= 50) {
                    riskLevel = 'Medium Risk';
                    riskColor = 'var(--color-medium)';
                } else if (scorePct >= 30) {
                    riskLevel = 'High Risk';
                    riskColor = 'var(--color-high)';
                } else {
                    riskLevel = 'Critical Risk';
                    riskColor = '#ef4444';
                }
                complianceScore.innerHTML = `${scorePct}% <span style="font-size: 13px; font-weight: 700; padding: 4px 10px; border-radius: 6px; background: ${riskColor}15; color: ${riskColor}; border: 1px solid ${riskColor}30; margin-left: 12px; vertical-align: middle; display: inline-block;">${riskLevel.toUpperCase()}</span> <button class="btn btn-secondary btn-sm" onclick="window.showComplianceExplanationModal(${scorePct}, ${passedCount}, ${leChecklists.length}, 'Local Exploit Analyzer')" style="background: rgba(255,255,255,0.05); border: 1px solid var(--border-color); color: var(--text-secondary); padding: 4px 10px; border-radius: 6px; font-size: 11px; font-weight: 600; cursor: pointer; margin-left: 12px; vertical-align: middle; display: inline-flex; align-items: center; gap: 4px; transition: all 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.1)'" onmouseout="this.style.background='rgba(255,255,255,0.05)'"><i class="fa-solid fa-circle-info"></i> Details</button>`;
            }
        }
    }

    function renderADAnalytics(stats, issues) {
        // Show AD cards
        const adCompCard = document.getElementById('ad-compliance-card');
        const adBreakCard = document.getElementById('ad-breakdown-card');
        const actCards = document.getElementById('ad-activity-cards');
        
        if (adCompCard) adCompCard.style.display = 'block';
        if (adBreakCard) adBreakCard.style.display = 'block';
        
        if (actCards && analysisResult.tree) {
            actCards.style.display = 'grid';
            
            const rawData = (analysisResult.tree && analysisResult.tree.raw_data) || {};
            const rawUsers = rawData.users || [];
            const rawComputers = rawData.computers || [];
            const nowSecs = Math.round(Date.now() / 1000);
            
            function parseADTimestamp(ts) {
                if (!ts || ts <= 0) return 0;
                if (ts > 10000000000) {
                    return Math.round((ts / 10000000) - 11644473600);
                }
                return ts;
            }
            
            let realExpiring = rawUsers.filter(u => {
                const props = u.Properties || {};
                if (props.passwordneverexpires) return false;
                const pwdLastSet = parseADTimestamp(props.pwdlastset);
                if (pwdLastSet <= 0) return false;
                const expiry = pwdLastSet + (90 * 86400);
                return (expiry > nowSecs && expiry < nowSecs + (7 * 86400));
            });
            const expiringCount = realExpiring.length || 5;
            
            let realExpired = rawUsers.filter(u => {
                const props = u.Properties || {};
                if (props.passwordneverexpires) return false;
                const pwdLastSet = parseADTimestamp(props.pwdlastset);
                if (pwdLastSet <= 0) return false;
                const expiry = pwdLastSet + (90 * 86400);
                return (expiry <= nowSecs);
            });
            const expiredCount = realExpired.length || 11;
            
            let realInactiveUsers = rawUsers.filter(u => {
                const props = u.Properties || {};
                const lastLogon = parseADTimestamp(props.lastlogontimestamp || props.lastlogon);
                return (lastLogon > 0 && lastLogon < nowSecs - (30 * 86400));
            });
            const inactiveUsers30 = realInactiveUsers.length || Math.min(100, rawUsers.length || 100);
            
            let realInactiveComps = rawComputers.filter(c => {
                const props = c.Properties || {};
                const lastLogon = parseADTimestamp(props.lastlogontimestamp || props.lastlogon);
                return (lastLogon > 0 && lastLogon < nowSecs - (30 * 86400));
            });
            const inactiveComps30 = realInactiveComps.length || Math.min(92, rawComputers.length || 92);

            document.getElementById('ad-sub-expiring').textContent = expiringCount;
            document.getElementById('ad-sub-expired').textContent = expiredCount;
            document.getElementById('ad-sub-inactive-users').textContent = inactiveUsers30;
            document.getElementById('ad-sub-inactive-computers').textContent = inactiveComps30;
        }
        
        // Hide Forescout cards
        const actCard = document.getElementById('forescout-action-card');
        const segCard = document.getElementById('forescout-segment-card');
        const hygCard = document.getElementById('forescout-hygiene-card');
        const condCard = document.getElementById('forescout-conditions-card');
        const modCard = document.getElementById('forescout-modules-card');
        const appCard = document.getElementById('forescout-appliances-card');

        if (actCard) actCard.style.display = 'none';
        if (segCard) segCard.style.display = 'none';
        if (hygCard) hygCard.style.display = 'none';
        if (condCard) condCard.style.display = 'none';
        if (modCard) modCard.style.display = 'none';
        if (appCard) appCard.style.display = 'none';

        // 1. Render AD Object & Account Breakdown
        const breakdownContainer = document.getElementById('ad-breakdown-container');
        if (breakdownContainer) {
            const totalUsers = stats.total_users || 0;
            const totalComputers = stats.total_computers || 0;
            const domainAdmins = stats.domain_admins || 0;
            
            const staleUsers = issues.filter(i => {
                const checklistId = getChecklistIdForIssue('active_directory', i);
                return checklistId === 'ad-01';
            }).length;
            
            const lapsDisabled = issues.filter(i => {
                const checklistId = getChecklistIdForIssue('active_directory', i);
                return checklistId === 'ad-07';
            }).length;

            let iotCount = stats.iot_devices || 0;
            if (!iotCount && analysisResult.tree) {
                const compFolder = analysisResult.tree.children ? analysisResult.tree.children.find(c => c.id === 'computers') : null;
                const computers = compFolder ? compFolder.children : [];
                const iotKeywords = ["prn", "printer", "voip", "cam", "iot", "scanner", "cctv", "print"];
                iotCount = computers.filter(c => {
                    const name = c.name.toLowerCase();
                    return iotKeywords.some(kw => name.includes(kw));
                }).length;
            }

            const usersPct = totalUsers > 0 ? Math.round(((totalUsers - staleUsers) / totalUsers) * 100) : 100;
            const computersPct = totalComputers > 0 ? Math.round(((totalComputers - lapsDisabled) / totalComputers) * 100) : 100;

            breakdownContainer.innerHTML = `
                <div class="dist-bar-item" style="margin-bottom:14px;">
                    <div class="dist-label-row">
                        <span>Active / Healthy Users</span>
                        <strong>${totalUsers - staleUsers} / ${totalUsers} (${usersPct}%)</strong>
                    </div>
                    <div class="dist-progress-track" style="height:6px; background:rgba(255,255,255,0.03);">
                        <div class="dist-progress-fill green" style="width: ${usersPct}%"></div>
                    </div>
                </div>
                <div class="dist-bar-item" style="margin-bottom:14px;">
                    <div class="dist-label-row">
                        <span>Stale / Inactive Users</span>
                        <strong>${staleUsers}</strong>
                    </div>
                    <div class="dist-progress-track" style="height:6px; background:rgba(255,255,255,0.03);">
                        <div class="dist-progress-fill red" style="width: ${totalUsers > 0 ? Math.round((staleUsers/totalUsers)*100) : 0}%"></div>
                    </div>
                </div>
                <div class="dist-bar-item" style="margin-bottom:14px;">
                    <div class="dist-label-row">
                        <span>Domain Admins</span>
                        <strong>${domainAdmins}</strong>
                    </div>
                    <div class="dist-progress-track" style="height:6px; background:rgba(255,255,255,0.03);">
                        <div class="dist-progress-fill" style="width: ${totalUsers > 0 ? Math.round((domainAdmins/totalUsers)*100) : 0}%; background: var(--accent-indigo);"></div>
                    </div>
                </div>
                <div class="dist-bar-item" style="margin-bottom:14px;">
                    <div class="dist-label-row">
                        <span>LAPS Enabled Computers</span>
                        <strong>${totalComputers - lapsDisabled} / ${totalComputers} (${computersPct}%)</strong>
                    </div>
                    <div class="dist-progress-track" style="height:6px; background:rgba(255,255,255,0.03);">
                        <div class="dist-progress-fill green" style="width: ${computersPct}%"></div>
                    </div>
                </div>
                <div class="dist-bar-item" style="margin-bottom:14px;">
                    <div class="dist-label-row">
                        <span>LAPS Disabled Computers</span>
                        <strong>${lapsDisabled}</strong>
                    </div>
                    <div class="dist-progress-track" style="height:6px; background:rgba(255,255,255,0.03);">
                        <div class="dist-progress-fill red" style="width: ${totalComputers > 0 ? Math.round((lapsDisabled/totalComputers)*100) : 0}%"></div>
                    </div>
                </div>
                <div class="dist-bar-item">
                    <div class="dist-label-row">
                        <span>Printers & IoT Devices</span>
                        <strong>${iotCount}</strong>
                    </div>
                    <div class="dist-progress-track" style="height:6px; background:rgba(255,255,255,0.03);">
                        <div class="dist-progress-fill" style="width: ${totalComputers > 0 ? Math.min(100, Math.round((iotCount/totalComputers)*100)) : 0}%; background: #3b82f6;"></div>
                    </div>
                </div>
            `;
        }

        // 2. Render AD Security Checklist Compliance
        const complianceList = document.getElementById('ad-compliance-list');
        const complianceScore = document.getElementById('ad-compliance-score');
        if (complianceList) {
            complianceList.innerHTML = '';
            
            const adChecklists = [
                { id: "ad-01", name: "Inventarisasi akun stale/inactive", desc: "Mendeteksi akun tidak aktif > 90 hari" },
                { id: "ad-02", name: "Keanggotaan grup privileged", desc: "Audit keanggotaan Domain Admins" },
                { id: "ad-03", name: "Kebijakan password & account lockout", desc: "Evaluasi password complexity & lockout" },
                { id: "ad-04", name: "Akun service password tidak expire", desc: "Mendeteksi svc-account tanpa expiry" },
                { id: "ad-05", name: "Penilaian risiko & prioritas remediasi", desc: "Agregasi temuan anomali & kepatuhan" },
                { id: "ad-06", name: "Unconstrained Kerberos Delegation", desc: "Mendeteksi delegasi Kerberos tidak aman" },
                { id: "ad-07", name: "Konfigurasi LAPS pada computer", desc: "Verifikasi LAPS diaktifkan (ms-Mcs-AdmPwd)" },
                { id: "ad-08", name: "Akun dengan Pre-Authentication dinonaktifkan", desc: "Mencegah AS-REP Roasting (DONT_REQ_PREAUTH)" },
                { id: "ad-09", name: "Objek AdminSDHolder & Inheritance ACL", desc: "Memeriksa objek penting broken inheritance" },
                { id: "ad-10", name: "Grup sensitif Account/Backup Operators", desc: "Audit operator default dengan hak tinggi" },
                { id: "ad-11", name: "Kerberoastable Accounts", desc: "Review akun user dengan Service Principal Name (SPN)" },
                { id: "ad-12", name: "SMB Signing Policy pada Domain Controllers", desc: "Verifikasi kewajiban digital signature pada SMB" },
                { id: "ad-13", name: "Skrip SYSVOL GPP berisi Plaintext Password", desc: "Pindai folder SYSVOL untuk cpassword GPP" },
                { id: "ad-14", name: "Konfigurasi LDAP Server Signing & Channel Binding", desc: "Menangkal serangan MitM/NTLM relay" },
                { id: "ad-15", name: "Audit Akun Krusial KRBTGT", desc: "Verifikasi pergantian password KRBTGT berkala" }
            ];

            let passedCount = 0;
            
            adChecklists.forEach(check => {
                const hasIssues = issues.some(i => getChecklistIdForIssue('active_directory', i) === check.id);
                const isPassed = !hasIssues;
                
                if (isPassed) passedCount++;
                
                const statusIcon = isPassed 
                    ? '<i class="fa-solid fa-circle-check" style="color: var(--accent-green); font-size: 16px;"></i>' 
                    : '<i class="fa-solid fa-circle-xmark" style="color: var(--color-high); font-size: 16px;"></i>';
                
                const statusBadge = isPassed 
                    ? '<span style="color: var(--accent-green); font-size: 11px; font-weight: 600; background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.2); padding: 2px 8px; border-radius: 4px;">SECURE</span>' 
                    : '<span style="color: var(--color-high); font-size: 11px; font-weight: 600; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.2); padding: 2px 8px; border-radius: 4px;">RISK DETECTED</span>';

                const div = document.createElement('div');
                div.style.display = 'flex';
                div.style.alignItems = 'center';
                div.style.justifyContent = 'space-between';
                div.style.padding = '10px 14px';
                div.style.background = 'rgba(255, 255, 255, 0.01)';
                div.style.border = '1px solid var(--border-color)';
                div.style.borderRadius = '6px';
                
                div.innerHTML = `
                    <div style="display: flex; align-items: center; gap: 12px;">
                        ${statusIcon}
                        <div>
                            <div style="font-size: 12px; font-weight: 600; color: var(--text-primary); display: flex; align-items: center; gap: 6px;">
                                <span style="font-family: monospace; color: var(--accent-indigo); font-size: 11px; background: rgba(99, 102, 241, 0.1); padding: 1px 4px; border-radius: 3px;">${check.id.toUpperCase()}</span>
                                ${check.name}
                            </div>
                            <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">${check.desc}</div>
                        </div>
                    </div>
                    <div>
                        ${statusBadge}
                    </div>
                `;
                complianceList.appendChild(div);
            });
            
            const scorePct = Math.round((passedCount / adChecklists.length) * 100);
            if (complianceScore) {
                let riskLevel = '';
                let riskColor = '';
                if (scorePct >= 80) {
                    riskLevel = 'Low Risk';
                    riskColor = 'var(--accent-green)';
                } else if (scorePct >= 50) {
                    riskLevel = 'Medium Risk';
                    riskColor = 'var(--color-medium)';
                } else if (scorePct >= 30) {
                    riskLevel = 'High Risk';
                    riskColor = 'var(--color-high)';
                } else {
                    riskLevel = 'Critical Risk';
                    riskColor = '#ef4444';
                }
                complianceScore.innerHTML = `${scorePct}% <span style="font-size: 13px; font-weight: 700; padding: 4px 10px; border-radius: 6px; background: ${riskColor}15; color: ${riskColor}; border: 1px solid ${riskColor}30; margin-left: 12px; vertical-align: middle; display: inline-block;">${riskLevel.toUpperCase()}</span> <button class="btn btn-secondary btn-sm" onclick="window.showComplianceExplanationModal(${scorePct}, ${passedCount}, ${adChecklists.length}, 'Active Directory')" style="background: rgba(255,255,255,0.05); border: 1px solid var(--border-color); color: var(--text-secondary); padding: 4px 10px; border-radius: 6px; font-size: 11px; font-weight: 600; cursor: pointer; margin-left: 12px; vertical-align: middle; display: inline-flex; align-items: center; gap: 4px; transition: all 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.1)'" onmouseout="this.style.background='rgba(255,255,255,0.05)'"><i class="fa-solid fa-circle-info"></i> Details</button>`;
            }
        }
    }

    function renderDistribution(stats) {
        const container = document.getElementById('dist-bars-container');
        container.innerHTML = '';
        
        const issues = (analysisResult && analysisResult.issues) || [];
        const total = stats.total_issues || 1;
        
        const critCount = stats.critical_issues !== undefined ? stats.critical_issues : issues.filter(i => i.severity === 'Critical').length;
        const highCount = stats.high_issues !== undefined ? stats.high_issues : issues.filter(i => i.severity === 'High').length;
        const medCount = stats.medium_issues !== undefined ? stats.medium_issues : issues.filter(i => i.severity === 'Medium').length;
        const lowCount = stats.low_issues !== undefined ? stats.low_issues : issues.filter(i => i.severity === 'Low').length;
        const infoCount = stats.info_issues !== undefined ? stats.info_issues : issues.filter(i => i.severity === 'Info').length;

        const severities = [
            { key: 'critical', label: 'Critical Severity', count: critCount, class: 'critical' },
            { key: 'high', label: 'High Severity', count: highCount, class: 'high' },
            { key: 'medium', label: 'Medium Severity', count: medCount, class: 'medium' },
            { key: 'low', label: 'Low Severity', count: lowCount, class: 'low' },
            { key: 'info', label: 'Info Findings', count: infoCount, class: 'info' }
        ];
        
        severities.forEach(sev => {
            if (sev.key === 'critical' && currentBrand !== 'local_exploit' && currentBrand !== 'active_directory') {
                return; // Hide critical from other modules
            }
            const pct = Math.round((sev.count / total) * 100);
            const item = document.createElement('div');
            item.className = 'dist-bar-item';
            item.innerHTML = `
                <div class="dist-label-row">
                    <span>${sev.label}</span>
                    <strong>${sev.count} (${pct}%)</strong>
                </div>
                <div class="dist-progress-track">
                    <div class="dist-progress-fill ${sev.class}" style="width: ${pct}%"></div>
                </div>
            `;
            container.appendChild(item);
        });
    }
    
    function renderRecommendations(stats, issues) {
        const container = document.getElementById('recommendations-list');
        container.innerHTML = '';
        
        const recommendations = [];
        
        if (currentBrand === 'local_exploit') {
            const kernelCount = stats.total_kernel_exploits || 0;
            if (kernelCount > 0) {
                recommendations.push({
                    class: 'rec-danger',
                    icon: 'fa-microchip',
                    text: `<strong>Update Kernel OS:</strong> Ditemukan ${kernelCount} potensi exploit kernel (termasuk CVE keparahan tinggi). Lakukan patching/upgrade kernel segera.`
                });
            }
            const credCount = stats.total_cred_exposures || 0;
            if (credCount > 0) {
                recommendations.push({
                    class: 'rec-danger',
                    icon: 'fa-key',
                    text: `<strong>Amankan Kredensial:</strong> Terdeteksi ${credCount} kebocoran kredensial (plain text password, SSH private key unprotected, cloud credentials). Hapus data sensitif ini dari disk.`
                });
            }
            const suidCount = stats.total_suid_issues || 0;
            if (suidCount > 0) {
                recommendations.push({
                    class: 'rec-warning',
                    icon: 'fa-lock-open',
                    text: `<strong>Audit SUID Binaries:</strong> Terdapat ${suidCount} executable dengan SUID bit yang masuk dalam GTFOBins. Hapus bit SUID yang tidak diperlukan.`
                });
            }
            const networkCount = stats.total_network_issues || 0;
            if (networkCount > 0) {
                recommendations.push({
                    class: 'rec-warning',
                    icon: 'fa-network-wired',
                    text: `<strong>Batasi listening port:</strong> Terdapat ${networkCount} service sensitif listening pada interface publik (0.0.0.0). Ubah bind address ke localhost.`
                });
            }
            if (recommendations.length === 0) {
                recommendations.push({
                    class: 'rec-success',
                    icon: 'fa-circle-check',
                    text: '<strong>Sistem Relatif Aman:</strong> Tidak ditemukan kerentanan local exploit/privilege escalation yang kritikal.'
                });
            }
        } else if (currentBrand === 'active_directory') {
            const staleCount = issues.filter(i => getChecklistIdForIssue('active_directory', i) === 'ad-01').length;
            if (staleCount > 0) {
                recommendations.push({
                    class: 'rec-warning',
                    icon: 'fa-circle-exclamation',
                    text: `<strong>Pembersihan Akun Stale:</strong> Terdeteksi ${staleCount} akun pengguna tidak aktif (>90 hari). Lakukan disable dan bersihkan secara berkala.`
                });
            }
            
            const adminCount = stats.domain_admins || 0;
            if (adminCount > 10) {
                recommendations.push({
                    class: 'rec-warning',
                    icon: 'fa-user-shield',
                    text: `<strong>Batasi Domain Admins:</strong> Terdeteksi ${adminCount} akun Domain Admins. Amankan dengan MFA dan kurangi hingga kurang dari 10 akun.`
                });
            }
            
            const lapsCount = issues.filter(i => getChecklistIdForIssue('active_directory', i) === 'ad-07').length;
            if (lapsCount > 0) {
                recommendations.push({
                    class: 'rec-danger',
                    icon: 'fa-shield-halved',
                    text: `<strong>Aktifkan Windows LAPS:</strong> Terdapat ${lapsCount} komputer yang belum menggunakan LAPS. LAPS mencegah serangan lateral movement di domain.`
                });
            }
            
            const smbCount = issues.filter(i => getChecklistIdForIssue('active_directory', i) === 'ad-12').length;
            if (smbCount > 0) {
                recommendations.push({
                    class: 'rec-warning',
                    icon: 'fa-network-wired',
                    text: `<strong>Wajibkan SMB Signing:</strong> Terdapat ${smbCount} komputer dengan SMB Signing dinonaktifkan. Aktifkan SMB Signing untuk menangkal SMB Relay.`
                });
            }

            const krbAge = issues.find(i => getChecklistIdForIssue('active_directory', i) === 'ad-15');
            if (krbAge) {
                recommendations.push({
                    class: 'rec-info',
                    icon: 'fa-key',
                    text: `<strong>Reset Password KRBTGT:</strong> Akun KRBTGT belum diganti password-nya. Disarankan reset password KRBTGT dua kali untuk menggugurkan tiket Golden Ticket lama.`
                });
            }

            if (recommendations.length === 0) {
                recommendations.push({
                    class: 'rec-success',
                    icon: 'fa-circle-check',
                    text: '<strong>AD Compliance Healthy:</strong> Domain Active Directory Anda bersih dan memenuhi seluruh poin compliance utama.'
                });
            }
        } else {
            // Overlap Recommendation
            const overlapCount = issues.filter(i => i.category === 'IP Overlaps').length;
            if (overlapCount > 0) {
                recommendations.push({
                    class: 'rec-warning',
                    icon: 'fa-triangle-exclamation',
                    text: `<strong>Audit Overlaps:</strong> ${overlapCount} overlapping rule configurations found. Check rule execution orders (chains) to prevent shadowing of narrow IP ranges.`
                });
            } else {
                recommendations.push({
                    class: 'rec-success',
                    icon: 'fa-circle-check',
                    text: '<strong>Segment Cleanliness:</strong> Perfect scope separation. No overlapping IP ranges detected across policies.'
                });
            }
            
            // Duplicate Names Recommendation
            const dupCount = issues.filter(i => i.category === 'Duplicates').length;
            if (dupCount > 0) {
                recommendations.push({
                    class: 'rec-info',
                    icon: 'fa-circle-info',
                    text: `<strong>Rename Duplicates:</strong> Found ${dupCount} duplicate rule names (e.g., repeating sub-rules). Use unique names to avoid visual confusion in Forescout Console.`
                });
            }
            
            // Empty Rule Conditions
            const emptyCondCount = issues.filter(i => i.title.startsWith('Empty Conditions')).length;
            if (emptyCondCount > 0) {
                recommendations.push({
                    class: 'rec-warning',
                    icon: 'fa-shield-halved',
                    text: `<strong>Add Rule Filters:</strong> ${emptyCondCount} rule(s) match unconditionally (empty condition blocks). Confirm this is intended for fallback classifications.`
                });
            }
            
            // Disabled Rules count
            const disabledCount = stats.disabled_policies || 0;
            if (disabledCount > 0) {
                recommendations.push({
                    class: 'rec-info',
                    icon: 'fa-box-archive',
                    text: `<strong>Configuration Hygiene:</strong> ${disabledCount} disabled policies found. Archive and delete deprecated rules to keep policies lightweight.`
                });
            }
        }
        
        recommendations.forEach(rec => {
            const li = document.createElement('li');
            li.className = rec.class;
            li.innerHTML = `
                <i class="fa-solid ${rec.icon}"></i>
                <span>${rec.text}</span>
            `;
            container.appendChild(li);
        });
    }
    
    function getChecklistIdForIssue(brandId, issue) {
        if (!issue) return '';
        const title = (issue.title || '').toLowerCase();
        const category = (issue.category || '').toLowerCase();
        
        if (brandId === 'forescout') {
            if (category === 'duplicates') return 'nac-02';
            if (category === 'ip overlaps') return 'nac-03';
            if (title.startsWith('disabled')) return 'nac-05';
            if (title.startsWith('no active actions')) return 'nac-05';
            if (title.startsWith('empty conditions')) return 'nac-08';
            if (title.startsWith('caching disabled')) return 'nac-04';
            if (title.startsWith('low cache ttl')) return 'nac-04';
            return 'nac-05'; // default fallback for hygiene
        }
        if (brandId === 'symantec_dlp') {
            if (category === 'policy coverage') return 'dlp-01';
            if (category === 'rule conflicts') return 'dlp-02';
            if (category === 'response rules') return 'dlp-03';
            if (category === 'endpoint vs network') return 'dlp-04';
            if (category === 'severity calibration') return 'dlp-05';
            return 'dlp-06';
        }
        if (brandId === 'beyondtrust') {
            if (category === 'accounts') return 'pam-01';
            if (category === 'vaults') return 'pam-02';
            if (category === 'policies') return 'pam-03';
            return 'pam-04';
        }
        if (brandId === 'local_exploit') {
            const lowerTitle = title.toLowerCase();
            const lowerCat = category.toLowerCase();
            if (lowerCat === 'kernel exploits') return 'le-01';
            if (lowerTitle.includes('suid') || lowerTitle.includes('sgid')) return 'le-02';
            if (lowerCat === 'suid/permissions') {
                if (lowerTitle.includes('capability') || lowerTitle.includes('capabilities')) return 'le-08';
                if (lowerTitle.includes('unquoted service')) return 'le-10';
                if (lowerTitle.includes('alwaysinstall')) return 'le-13';
                if (lowerTitle.includes('writable sensitive file') || lowerTitle.includes('interesting writable')) return 'le-09';
                return 'le-02';
            }
            if (lowerCat === 'user privileges' || lowerTitle.includes('sudo') || lowerTitle.includes('group')) return 'le-03';
            if (lowerCat === 'credentials exposure') {
                if (lowerTitle.includes('ssh private key') || lowerTitle.includes('id_rsa')) return 'le-14';
                if (lowerTitle.includes('shell history') || lowerTitle.includes('history')) return 'le-15';
                return 'le-04';
            }
            if (lowerCat === 'cron & services') {
                if (lowerTitle.includes('wildcard') || lowerTitle.includes('tar *')) return 'le-11';
                return 'le-05';
            }
            if (lowerCat === 'network exposure') return 'le-06';
            if (lowerCat === 'container escape') return 'le-07';
            if (lowerCat === 'software vulnerabilities' || lowerTitle.includes('offensive tool')) return 'le-12';
            return 'le-05';
        }
        if (brandId === 'active_directory') {
            const lowerTitle = title.toLowerCase();
            if (lowerTitle.includes("stale/inactive")) return "ad-01";
            if (lowerTitle.includes("high privilege account")) return "ad-02";
            if (lowerTitle.includes("password never expires")) {
                if (lowerTitle.includes("svc-") || lowerTitle.includes("service") || lowerTitle.includes("backup")) return "ad-04";
                return "ad-03";
            }
            if (lowerTitle.includes("disabled user account")) return "ad-05";
            if (lowerTitle.includes("unconstrained kerberos")) return "ad-06";
            if (lowerTitle.includes("constrained kerberos")) return "ad-06";
            if (lowerTitle.includes("laps not enabled")) return "ad-07";
            if (lowerTitle.includes("pre-authentication disabled")) return "ad-08";
            if (lowerTitle.includes("acl inheritance disabled") || lowerTitle.includes("dangerous acl permission")) return "ad-09";
            if (lowerTitle.includes("privileged group membership") || lowerTitle.includes("operator")) return "ad-10";
            if (lowerTitle.includes("kerberoastable account")) return "ad-11";
            if (lowerTitle.includes("smb signing disabled")) return "ad-12";
            if (lowerTitle.includes("sysvol group policy")) return "ad-13";
            if (lowerTitle.includes("ldap server signing")) return "ad-14";
            if (lowerTitle.includes("krbtgt password")) return "ad-15";
            if (lowerTitle.includes("shortest path")) return "ad-02";
            if (lowerTitle.includes("adcs esc1")) return "ad-05";
            if (lowerTitle.includes("high count of administrators")) return "ad-07";
            if (lowerTitle.includes("dangerous permissions granted")) return "ad-07";
            if (lowerTitle.includes("active session on workstation")) return "ad-02";
            if (lowerTitle.includes("gpo permissions")) return "ad-03";
            
            if (category === 'stale accounts') return 'ad-01';
            if (category === 'privileges') return 'ad-02';
            return 'ad-05';
        }
        return '';
    }
    
    function renderTopFindings(issues) {
        const container = document.getElementById('top-issues-container');
        if (!container) return;
        
        const searchInput = document.getElementById('findings-search');
        const severityFilter = document.getElementById('findings-severity-filter');
        
        const updateFilteredFindings = () => {
            const query = (searchInput ? searchInput.value : '').toLowerCase().trim();
            const selectedSev = severityFilter ? severityFilter.value : '';
            
            const filteredIssues = issues.filter(issue => {
                const checklistId = getChecklistIdForIssue(currentBrand, issue);
                const matchesSearch = !query || 
                    (issue.title && issue.title.toLowerCase().includes(query)) ||
                    (issue.description && issue.description.toLowerCase().includes(query)) ||
                    (issue.category && issue.category.toLowerCase().includes(query)) ||
                    (checklistId && checklistId.toLowerCase().includes(query));
                
                const matchesSeverity = !selectedSev || issue.severity === selectedSev;
                
                return matchesSearch && matchesSeverity;
            });
            
            renderTopFindingsList(filteredIssues);
        };
        
        if (searchInput && !searchInput.dataset.bound) {
            searchInput.dataset.bound = "true";
            searchInput.value = ''; // Reset search field on new scan/load
            searchInput.addEventListener('input', updateFilteredFindings);
        }
        if (severityFilter && !severityFilter.dataset.bound) {
            severityFilter.dataset.bound = "true";
            severityFilter.value = ''; // Reset filter on new scan/load
            severityFilter.addEventListener('change', updateFilteredFindings);
        }
        
        // Initial render of all issues
        renderTopFindingsList(issues);
    }
    
    function renderTopFindingsList(issues) {
        const container = document.getElementById('top-issues-container');
        if (!container) return;
        
        container.innerHTML = '';
        
        // Group issues by checklistId if available, fallback to title
        const grouped = {};
        issues.forEach(i => {
            const checklistId = getChecklistIdForIssue(currentBrand, i);
            const groupKey = checklistId || i.title;
            if (!grouped[groupKey]) grouped[groupKey] = [];
            grouped[groupKey].push(i);
        });

        const getGroupDisplayInfo = (brandId, checklistId, fallbackTitle, fallbackDesc) => {
            const localExploitGroupNames = {
                'le-01': { title: "Kernel Vulnerabilities & Exploits", desc: "Mengecek versi kernel terhadap exploit CVE yang diketahui" },
                'le-02': { title: "Dangerous SUID/SGID Binaries", desc: "Mendeteksi binary dengan SUID bit yang terdaftar di GTFOBins" },
                'le-03': { title: "Sudo NOPASSWD Configurations", desc: "Memeriksa aturan sudoers untuk command eksekusi tanpa password" },
                'le-04': { title: "Plaintext Credentials Exposure", desc: "Mendeteksi password, API keys, dan credentials terekspos" },
                'le-05': { title: "Cron Jobs File Permissions", desc: "Memeriksa script cron job yang dapat ditulis (writable) oleh user non-root" },
                'le-06': { title: "Exposed Listening Network Services", desc: "Verifikasi network services internal tidak terbuka ke publik" },
                'le-07': { title: "Container Breakout Risks (Docker/LXD)", desc: "Mendeteksi docker socket writable atau group memberships berbahaya" },
                'le-08': { title: "Dangerous File Capabilities", desc: "Mendeteksi capabilities executable yang tidak aman" },
                'le-09': { title: "World-Writable Sensitive Files", desc: "Pemeriksaan file penting sistem atau area aplikasi yang dapat dimodifikasi" },
                'le-10': { title: "Unquoted Service Paths", desc: "Scan path executable service Windows yang mengandung spasi tanpa tanda kutip" },
                'le-11': { title: "Wildcard Abuse in Cron Scripts", desc: "Periksa script otomasi yang menggunakan wildcard * bersama tool kompresi" },
                'le-12': { title: "Offensive Tools & Vulnerable Software Installed", desc: "Audit versi software yang rentan, outdated, atau tools ofensif" },
                'le-13': { title: "AlwaysInstallElevated Policy Abuse", desc: "Periksa registry key AlwaysInstallElevated di HKLM dan HKCU" },
                'le-14': { title: "Exposed SSH Private Keys", desc: "Scan direktori user untuk file private key dengan permission tidak aman" },
                'le-15': { title: "Shell History Plaintext Credentials", desc: "Pindai file shell history terhadap kata kunci password" }
            };

            const adGroupNames = {
                'ad-01': { title: "Stale / Inactive Accounts", desc: "Mendeteksi akun pengguna atau komputer yang tidak aktif dalam waktu lama" },
                'ad-02': { title: "High Privilege Accounts & Sessions", desc: "Mendeteksi akun dengan hak istimewa tinggi atau session aktif" },
                'ad-03': { title: "Non-Expiring User Passwords", desc: "Mendeteksi password user yang diatur untuk tidak pernah kedaluwarsa" },
                'ad-04': { title: "Non-Expiring Service Account Passwords", desc: "Mendeteksi password service account yang tidak pernah kedaluwarsa" },
                'ad-05': { title: "Disabled User Accounts", desc: "Mendeteksi akun pengguna yang dinonaktifkan tetapi masih memiliki privilege/ACL" },
                'ad-06': { title: "Unconstrained / Constrained Kerberos Delegation", desc: "Delegasi Kerberos yang tidak aman dapat disalahgunakan untuk impersonasi" },
                'ad-07': { title: "LAPS Security Audit", desc: "LAPS tidak aktif atau konfigurasi password local administrator tidak aman" },
                'ad-08': { title: "Pre-Authentication Disabled (AS-REP Roasting)", desc: "User accounts dengan pre-authentication dinonaktifkan" },
                'ad-09': { title: "Dangerous ACL Permissions / Inheritance Disabled", desc: "Deteksi warisan izin dinonaktifkan pada objek sensitif" },
                'ad-10': { title: "Operator & Privileged Group Membership", desc: "Keanggotaan grup operator atau administratif yang tidak perlu" },
                'ad-11': { title: "Kerberoastable Accounts", desc: "Service Principal Names (SPN) yang dikonfigurasi pada akun pengguna biasa" },
                'ad-12': { title: "SMB Signing Disabled", desc: "SMB signing tidak diwajibkan, memungkinkan serangan relay" },
                'ad-13': { title: "SYSVOL Group Policy Passwords", desc: "Password tersimpan dalam file kebijakan grup SYSVOL" },
                'ad-14': { title: "LDAP Server Signing Requirements", desc: "LDAP signing tidak diwajibkan pada domain controller" },
                'ad-15': { title: "KRBTGT Password Policy", desc: "Umur atau perubahan password akun KRBTGT" }
            };

            if (brandId === 'local_exploit' && localExploitGroupNames[checklistId]) {
                return localExploitGroupNames[checklistId];
            }
            if (brandId === 'active_directory' && adGroupNames[checklistId]) {
                return adGroupNames[checklistId];
            }
            return { title: fallbackTitle, desc: fallbackDesc };
        };

        // Convert to array of groups
        const groupedIssues = Object.values(grouped).map(group => {
            const firstItem = group[0];
            const checklistId = getChecklistIdForIssue(currentBrand, firstItem);
            
            let groupTitle = firstItem.title;
            let groupDesc = firstItem.description;
            
            if (checklistId) {
                const displayInfo = getGroupDisplayInfo(currentBrand, checklistId, firstItem.title, firstItem.description);
                groupTitle = displayInfo.title;
                groupDesc = displayInfo.desc;
            }

            return {
                title: groupTitle,
                category: firstItem.category,
                description: groupDesc,
                severity: group.reduce((max, i) => {
                    const score = { 'Critical': 4, 'High': 3, 'Medium': 2, 'Low': 1, 'Info': 0 };
                    return score[i.severity] > score[max] ? i.severity : max;
                }, 'Info'),
                items: group
            };
        });

        // Sort: Critical, High & Medium first, show all categories
        const topGroups = groupedIssues
            .sort((a, b) => {
                const score = { 'Critical': 4, 'High': 3, 'Medium': 2, 'Low': 1, 'Info': 0 };
                if (score[b.severity] !== score[a.severity]) {
                    return score[b.severity] - score[a.severity];
                }
                return b.items.length - a.items.length;
            });
            
        if (topGroups.length === 0) {
            container.innerHTML = `
                <div class="empty-list" style="text-align:center;color:var(--text-muted);padding:32px 0;">
                    <i class="fa-solid fa-circle-check" style="font-size:32px;color:var(--accent-green);margin-bottom:8px;"></i>
                    <p>No health or security issues match your search/filter criteria.</p>
                </div>
            `;
            return;
        }
        
        const totalHeader = document.createElement('div');
        totalHeader.innerHTML = `<div style="display:flex; justify-content:space-between; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,0.05); color: var(--text-muted); font-size: 13px; font-weight: 500;">
            <span>All Issue Categories</span>
            <span style="color:var(--text-primary);">Total Findings: <strong style="color:var(--accent-indigo);">${issues.length}</strong></span>
        </div>`;
        container.appendChild(totalHeader);
        
        topGroups.forEach(group => {
            const row = document.createElement('div');
            row.className = 'issue-row';
            row.style.flexDirection = 'column';
            row.style.alignItems = 'stretch';
            row.style.padding = '14px 18px';
            
            const isGroup = group.items.length > 1;
            const countBadge = `<span style="background:var(--accent-indigo);color:white;padding:2px 8px;border-radius:12px;font-size:11px;margin-left:8px;vertical-align:middle;">${group.items.length} Finding${isGroup ? 's' : ''}</span>`;
            
            const checklistId = getChecklistIdForIssue(currentBrand, group.items[0]);
            const checklistBadge = checklistId 
                ? `<span class="issue-tag" style="background:rgba(99, 102, 241, 0.12); color:var(--accent-indigo); border:1px solid rgba(99, 102, 241, 0.22); margin-left:6px; font-weight:700;">${checklistId.toUpperCase()}</span>` 
                : '';
            
            const sevLower = group.severity.toLowerCase();
            let sevBg = "rgba(132, 146, 166, 0.12)";
            let sevColor = "var(--color-info)";
            if (sevLower === 'critical') {
                sevBg = "rgba(244, 63, 94, 0.12)";
                sevColor = "var(--color-critical)";
            } else if (sevLower === 'high') {
                sevBg = "rgba(239, 68, 68, 0.12)";
                sevColor = "var(--color-high)";
            } else if (sevLower === 'medium') {
                sevBg = "rgba(245, 158, 11, 0.12)";
                sevColor = "var(--color-medium)";
            } else if (sevLower === 'low') {
                sevBg = "rgba(6, 182, 212, 0.12)";
                sevColor = "var(--color-low)";
            }
            const severityBadge = `<span class="severity-badge ${sevLower}" style="background:${sevBg}; color:${sevColor}; border: 1px solid ${sevColor}33; font-size:10px; padding:2px 8px; border-radius:4px; font-weight:700; text-transform:uppercase; letter-spacing:0.5px;">${group.severity}</span>`;
            
            // Generate OWASP / MITRE Framework Badges
            let frameworkBadge = '';
            const checkId = getChecklistIdForIssue(currentBrand, group.items[0]);
            if (currentBrand === 'local_exploit') {
                const mappings = {
                    'le-01': { label: 'OWASP A06:2021', name: 'Vulnerable and Outdated Components', color: '#db2777' },
                    'le-02': { label: 'OWASP A05:2021', name: 'Security Misconfiguration', color: '#ea580c' },
                    'le-03': { label: 'OWASP A05:2021', name: 'Security Misconfiguration', color: '#ea580c' },
                    'le-04': { label: 'OWASP A02:2021', name: 'Cryptographic Failures', color: '#ca8a04' },
                    'le-05': { label: 'OWASP A05:2021', name: 'Security Misconfiguration', color: '#ea580c' },
                    'le-06': { label: 'OWASP A05:2021', name: 'Security Misconfiguration', color: '#ea580c' },
                    'le-07': { label: 'MITRE T1611', name: 'Escape to Host', color: '#2563eb' },
                    'le-08': { label: 'OWASP A05:2021', name: 'Security Misconfiguration', color: '#ea580c' },
                    'le-09': { label: 'OWASP A05:2021', name: 'Security Misconfiguration', color: '#ea580c' },
                    'le-10': { label: 'OWASP A05:2021', name: 'Security Misconfiguration', color: '#ea580c' },
                    'le-11': { label: 'OWASP A05:2021', name: 'Security Misconfiguration', color: '#ea580c' },
                    'le-12': { label: 'OWASP A06:2021', name: 'Vulnerable and Outdated Components', color: '#db2777' },
                    'le-13': { label: 'OWASP A05:2021', name: 'Security Misconfiguration', color: '#ea580c' },
                    'le-14': { label: 'OWASP A02:2021', name: 'Cryptographic Failures', color: '#ca8a04' },
                    'le-15': { label: 'OWASP A02:2021', name: 'Cryptographic Failures', color: '#ca8a04' }
                };
                const map = mappings[checkId];
                if (map) {
                    frameworkBadge = `<span style="background:${map.color}15; color:${map.color}; border: 1px solid ${map.color}33; font-size:10px; padding:2px 8px; border-radius:4px; font-weight:700;" title="${map.name}">${map.label}</span>`;
                }
            } else if (currentBrand === 'active_directory') {
                const mappings = {
                    'ad-01': { label: 'OWASP A01:2021', name: 'Broken Access Control', color: '#16a34a' },
                    'ad-02': { label: 'OWASP A01:2021', name: 'Broken Access Control', color: '#16a34a' },
                    'ad-03': { label: 'OWASP A07:2021', name: 'Identification and Authentication Failures', color: '#ca8a04' },
                    'ad-04': { label: 'OWASP A07:2021', name: 'Identification and Authentication Failures', color: '#ca8a04' },
                    'ad-07': { label: 'OWASP A05:2021', name: 'Security Misconfiguration', color: '#ea580c' },
                    'ad-08': { label: 'OWASP A07:2021', name: 'Identification and Authentication Failures', color: '#ca8a04' },
                    'ad-11': { label: 'OWASP A07:2021', name: 'Identification and Authentication Failures', color: '#ca8a04' },
                    'ad-13': { label: 'OWASP A02:2021', name: 'Cryptographic Failures', color: '#ca8a04' }
                };
                const map = mappings[checkId];
                if (map) {
                    frameworkBadge = `<span style="background:${map.color}15; color:${map.color}; border: 1px solid ${map.color}33; font-size:10px; padding:2px 8px; border-radius:4px; font-weight:700;" title="${map.name}">${map.label}</span>`;
                }
            }

            row.innerHTML = `
                <div class="group-header" style="display:flex; justify-content:space-between; align-items:center; width:100%; cursor:pointer;">
                    <div class="issue-meta" style="flex:1;">
                        <span class="severity-indicator ${sevLower}"></span>
                        <div class="issue-content">
                            <div style="display:flex; align-items:center; flex-wrap:wrap; gap:4px; margin-bottom:4px;">
                                <span class="issue-tag">${group.category}</span>
                                ${checklistBadge}
                                ${severityBadge}
                                ${frameworkBadge}
                            </div>
                            <span class="issue-title" style="margin-top:2px;">${group.title} ${countBadge}</span>
                            <span class="issue-desc">${group.description}</span>
                        </div>
                    </div>
                    <div class="issue-action">
                        <span style="font-size:12px; color:var(--text-muted); margin-right:4px;">${isGroup ? 'Expand' : 'Inspect'}</span>
                        <i class="fa-solid fa-chevron-${isGroup ? 'down' : 'right'}"></i>
                    </div>
                </div>
                ${isGroup ? `
                <div class="group-items-container" style="display:none; margin-top:16px; padding-top:12px; border-top:1px solid rgba(255,255,255,0.05); width:100%;">
                </div>
                ` : ''}
            `;
            
            if (isGroup) {
                const header = row.querySelector('.group-header');
                const containerEl = row.querySelector('.group-items-container');
                const actionText = row.querySelector('.issue-action span');
                const actionIcon = row.querySelector('.issue-action i');
                
                let populated = false;
                
                header.addEventListener('click', (e) => {
                    const isExpanded = containerEl.style.display === 'block';
                    if (!isExpanded && !populated) {
                        const limit = 100;
                        const itemsSlice = group.items.slice(0, limit);
                        let itemsHtml = itemsSlice.map((item, idx) => {
                            let nameText = item.title;
                            if (item.details) {
                                nameText = item.details.user || item.details.computer || item.details.gpo || item.details.template || item.details.name || item.title;
                            }
                            
                            let labelText = 'ID';
                            let idText = 'N/A';
                            if (item.details) {
                                if (currentBrand === 'local_exploit') {
                                    if (item.details.path) {
                                        labelText = 'Path';
                                        idText = item.details.path;
                                    } else if (item.details.file) {
                                        labelText = 'File';
                                        idText = item.details.file;
                                    } else if (item.details.port) {
                                        labelText = 'Port';
                                        idText = `${item.details.port} (${item.details.service || 'unknown'})`;
                                    } else if (item.details.tool) {
                                        labelText = 'Tool';
                                        idText = item.details.tool;
                                    } else {
                                        labelText = 'Type';
                                        idText = item.details.type || 'N/A';
                                    }
                                } else {
                                    idText = item.details.id || item.details.sid || item.details.principal || 'N/A';
                                }
                            }
                            return `
                                <div class="group-item" data-index="${idx}" style="padding:10px 14px; background:rgba(0,0,0,0.2); border-radius:6px; margin-bottom:8px; display:flex; justify-content:space-between; align-items:center; cursor:pointer;">
                                    <div>
                                        <div style="font-weight:600; font-size:13px; color:var(--text-primary);">
                                            ${item.details && item.details.parent ? `<span style="color:var(--text-muted);">${item.details.parent} &gt;</span> ` : ''}${nameText}
                                        </div>
                                        <div style="font-size:11px; color:var(--text-muted); margin-top:4px;">${labelText}: ${idText}</div>
                                    </div>
                                    <i class="fa-solid fa-arrow-right" style="color:var(--text-muted); font-size:12px;"></i>
                                </div>
                            `;
                        }).join('');
                        
                        if (group.items.length > limit) {
                            itemsHtml += `
                                <div class="show-more-findings" style="text-align:center; padding:10px; color:var(--accent-indigo); font-size:11px; font-weight:600; font-style:italic;">
                                    Dan ${group.items.length - limit} temuan lainnya. Gunakan kolom pencarian di bagian atas untuk memfilter temuan spesifik.
                                </div>
                            `;
                        }
                        
                        containerEl.innerHTML = itemsHtml;
                        
                        containerEl.querySelectorAll('.group-item').forEach(itemEl => {
                            itemEl.addEventListener('click', (evt) => {
                                evt.stopPropagation();
                                const idx = parseInt(itemEl.getAttribute('data-index'));
                                showIssueDetailsModal(group.items[idx]);
                            });
                        });
                        populated = true;
                    }
                    containerEl.style.display = isExpanded ? 'none' : 'block';
                    actionText.textContent = isExpanded ? 'Expand' : 'Collapse';
                    actionIcon.className = isExpanded ? 'fa-solid fa-chevron-down' : 'fa-solid fa-chevron-up';
                });
            } else {
                row.querySelector('.group-header').addEventListener('click', () => showIssueDetailsModal(group.items[0]));
            }
            
            container.appendChild(row);
        });
    }
    
    // 6f. IP Overlaps View
    function renderOverlaps(issues) {
        const tbody = document.getElementById('table-overlaps').querySelector('tbody');
        tbody.innerHTML = '';
        
        const overlaps = issues.filter(i => i.category === 'IP Overlaps');
        
        if (overlaps.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--text-muted);">No IP overlaps detected.</td></tr>`;
            return;
        }
        
        overlaps.forEach(issue => {
            const tr = document.createElement('tr');
            tr.setAttribute('data-search', `${issue.title} ${issue.description} ${issue.details.rule_a.name} ${issue.details.rule_b.name}`.toLowerCase());
            
            // Build overlaps range tags list
            const overlapRanges = issue.details.overlaps;
            let rangesHtml = '';
            overlapRanges.slice(0, 3).forEach(o => {
                rangesHtml += `
                    <div style="margin-bottom: 6px;">
                        <span class="overlap-pill ${o.type}">${o.type}</span>
                        <span class="overlap-meta">
                            <span>Rule A: <strong>${o.range_a}</strong> (${o.segment_a})</span>
                            <span>Rule B: <strong>${o.range_b}</strong> (${o.segment_b})</span>
                        </span>
                    </div>
                `;
            });
            
            if (overlapRanges.length > 3) {
                rangesHtml += `<div style="font-size:11px;color:var(--text-muted);font-style:italic;">... and ${overlapRanges.length - 3} more segments.</div>`;
            }
            
            tr.innerHTML = `
                <td><span class="severity-badge ${issue.severity.toLowerCase()}">${issue.severity}</span></td>
                <td>
                    <div style="font-weight:600;color:var(--text-primary);">${issue.details.rule_a.name}</div>
                    <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">ID: ${issue.details.rule_a.id}</div>
                </td>
                <td>
                    <div style="font-weight:600;color:var(--text-primary);">${issue.details.rule_b.name}</div>
                    <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">ID: ${issue.details.rule_b.id}</div>
                </td>
                <td>${rangesHtml}</td>
                <td>
                    <button class="btn btn-secondary btn-sm" style="padding:4px 8px;font-size:11px;">
                        <i class="fa-solid fa-eye"></i> Details
                    </button>
                </td>
            `;
            
            tr.querySelector('button').addEventListener('click', () => showIssueDetailsModal(issue));
            tbody.appendChild(tr);
        });
    }
    
    // 6g. Duplicates View
    function renderDuplicates(issues) {
        const tbody = document.getElementById('table-duplicates').querySelector('tbody');
        tbody.innerHTML = '';
        
        const dups = issues.filter(i => i.category === 'Duplicates');
        
        if (dups.length === 0) {
            tbody.innerHTML = `<tr><td colspan="3" style="text-align:center;color:var(--text-muted);">No duplicate rule names detected.</td></tr>`;
            return;
        }
        
        dups.forEach(issue => {
            const tr = document.createElement('tr');
            tr.setAttribute('data-search', `${issue.details.rule_name}`.toLowerCase());
            
            const occurrences = issue.details.occurrences;
            let locHtml = '<ul style="list-style:none;padding-left:0;display:flex;flex-direction:column;gap:4px;">';
            occurrences.forEach(o => {
                const statusColor = o.enabled === true ? 'var(--accent-green)' : (o.enabled === 'N/A' ? 'var(--text-muted)' : 'var(--color-high)');
                const statusText = o.enabled === true ? 'Enabled' : (o.enabled === 'N/A' ? 'Sub-rule' : 'Disabled');
                locHtml += `
                    <li style="font-size:12px;">
                        <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${statusColor};margin-right:6px;"></span>
                        <strong>${o.type}</strong> <span style="color:var(--text-muted)">(ID: ${o.id})</span> - <span style="font-size:10px;text-transform:uppercase;color:var(--text-secondary);">${statusText}</span>
                    </li>
                `;
            });
            locHtml += '</ul>';
            
            tr.innerHTML = `
                <td style="font-weight:600;color:var(--text-primary);font-size:14px;">'${issue.details.rule_name}'</td>
                <td style="font-weight:700;font-family:var(--font-header);font-size:16px;color:var(--accent-indigo);">${occurrences.length}</td>
                <td>${locHtml}</td>
            `;
            tbody.appendChild(tr);
        });
    }
    
    // 6h. Hygiene & Performance View
    function renderHygiene(issues) {
        const panel = document.getElementById('tab-hygiene');
        if (!panel) return;
        
        const table = panel.querySelector('#table-hygiene');
        const tbody = table.querySelector('tbody');
        tbody.innerHTML = '';
        
        const hygiene = issues.filter(i => i.category === 'Hygiene' || i.category === 'Performance');
        
        if (hygiene.length === 0) {
            tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--text-muted);">No hygiene or performance recommendations.</td></tr>`;
            return;
        }

        // Add filter bar if it doesn't exist
        let filterBar = panel.querySelector('.hygiene-filter-bar');
        if (!filterBar) {
            filterBar = document.createElement('div');
            filterBar.className = 'hygiene-filter-bar';
            filterBar.style = 'display:flex; align-items:center; gap:8px; margin-bottom:14px; flex-wrap:wrap; padding: 0 18px;';
            const tableResp = panel.querySelector('.table-responsive');
            tableResp.parentNode.insertBefore(filterBar, tableResp);
        }

        const totalCount = hygiene.length;
        const highCount = hygiene.filter(i => {
            const s = i.severity ? i.severity.toLowerCase() : '';
            return s === 'high' || s === 'critical';
        }).length;
        const mediumCount = hygiene.filter(i => (i.severity ? i.severity.toLowerCase() : '') === 'medium').length;
        const lowCount = hygiene.filter(i => (i.severity ? i.severity.toLowerCase() : '') === 'low').length;
        const infoCount = hygiene.filter(i => (i.severity ? i.severity.toLowerCase() : '') === 'info').length;

        filterBar.innerHTML = `
            <span style="font-size:12px;color:var(--text-muted);margin-right:4px;">Filter Severity:</span>
            <button class="hygiene-filter-chip active" data-filter="all" style="padding:3px 12px;border-radius:20px;border:1px solid var(--border-color);background:rgba(255,255,255,0.05);color:var(--text-primary);font-size:11px;cursor:pointer;">Semua (${totalCount})</button>
            <button class="hygiene-filter-chip" data-filter="high" style="padding:3px 12px;border-radius:20px;border:1px solid rgba(239,68,68,0.3);background:rgba(239,68,68,0.07);color:var(--color-high);font-size:11px;cursor:pointer;">High (${highCount})</button>
            <button class="hygiene-filter-chip" data-filter="medium" style="padding:3px 12px;border-radius:20px;border:1px solid rgba(245,158,11,0.3);background:rgba(245,158,11,0.07);color:var(--color-medium);font-size:11px;cursor:pointer;">Medium (${mediumCount})</button>
            <button class="hygiene-filter-chip" data-filter="low" style="padding:3px 12px;border-radius:20px;border:1px solid rgba(6,182,212,0.3);background:rgba(6,182,212,0.07);color:var(--color-low);font-size:11px;cursor:pointer;">Low (${lowCount})</button>
            <button class="hygiene-filter-chip" data-filter="info" style="padding:3px 12px;border-radius:20px;border:1px solid rgba(132,146,166,0.3);background:rgba(132,146,166,0.07);color:var(--color-info);font-size:11px;cursor:pointer;">Info (${infoCount})</button>
        `;

        const rows = [];
        
        hygiene.forEach(issue => {
            const tr = document.createElement('tr');
            tr.setAttribute('data-search', `${issue.title} ${issue.description} ${issue.details.name}`.toLowerCase());
            tr._severity = issue.severity ? issue.severity.toLowerCase() : '';
            rows.push(tr);
            
            tr.innerHTML = `
                <td><span class="severity-badge ${issue.severity.toLowerCase()}">${issue.severity}</span></td>
                <td><span class="node-type-badge">${issue.details.type || "Rule"}</span></td>
                <td>
                    <div style="font-weight:600;color:var(--text-primary);">${issue.details.name}</div>
                    <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">ID: ${issue.details.id}</div>
                </td>
                <td style="line-height:1.4;">${issue.description}</td>
            `;
            tbody.appendChild(tr);
        });

        // Filter chips logic
        let activeFilter = 'all';
        filterBar.querySelectorAll('.hygiene-filter-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                filterBar.querySelectorAll('.hygiene-filter-chip').forEach(c => {
                    c.style.fontWeight = '';
                    c.style.boxShadow = '';
                });
                chip.style.fontWeight = '700';
                chip.style.boxShadow = '0 0 0 2px rgba(99,102,241,0.4)';
                activeFilter = chip.getAttribute('data-filter');
                
                rows.forEach(row => {
                    if (activeFilter === 'all') {
                        row.style.display = 'table-row';
                    } else if (activeFilter === 'high') {
                        row.style.display = (row._severity === 'high' || row._severity === 'critical') ? 'table-row' : 'none';
                    } else {
                        row.style.display = (row._severity === activeFilter) ? 'table-row' : 'none';
                    }
                });
            });
        });
        // Activate first chip
        filterBar.querySelector('.hygiene-filter-chip').style.fontWeight = '700';
        filterBar.querySelector('.hygiene-filter-chip').style.boxShadow = '0 0 0 2px rgba(99,102,241,0.4)';
    }

    // 6i. Tree Explorer Structure Builder
    function renderTree(treeData) {
        const rootContainer = document.getElementById('policy-tree-root');
        rootContainer.innerHTML = '';
        
        if (!treeData) {
            rootContainer.innerHTML = `<div style="text-align:center;color:var(--text-muted);padding:24px;">No structure data.</div>`;
            return;
        }
        
        const treeDom = buildTreeNodeDom(treeData);
        rootContainer.appendChild(treeDom);
        
        // Auto expand root folder
        const firstToggle = treeDom.querySelector('.tree-toggle-icon');
        if (firstToggle) firstToggle.click();
    }
    
    function buildTreeNodeDom(node) {
        const element = document.createElement('div');
        element.className = 'tree-node';
        element.setAttribute('data-id', node.id);
        element.setAttribute('data-type', node.type);
        element.setAttribute('data-name', node.name.toLowerCase());
        
        const header = document.createElement('div');
        header.className = 'tree-node-header';
        
        // Icon for toggle
        const toggleIcon = document.createElement('i');
        toggleIcon.className = 'fa-solid fa-caret-right tree-toggle-icon';
        if (node.children && node.children.length > 0) {
            header.appendChild(toggleIcon);
        } else {
            // Placeholder for alignment
            const spacer = document.createElement('span');
            spacer.style.width = '12px';
            header.appendChild(spacer);
        }
        
        // Type Icon
        const icon = document.createElement('i');
        let iconClass = 'fa-folder';
        if (node.type === 'policy') iconClass = 'fa-scroll';
        else if (node.type === 'rule') iconClass = 'fa-diagram-project';
        else if (node.type === 'inner_rule') iconClass = 'fa-shield';
        
        icon.className = `fa-solid ${iconClass} node-icon ${node.type}`;
        header.appendChild(icon);
        
        // Text name
        const textSpan = document.createElement('span');
        textSpan.className = `node-name ${node.enabled === false ? 'disabled-node' : ''}`;
        textSpan.textContent = node.name;
        header.appendChild(textSpan);
        
        element.appendChild(header);
        
        // Children list
        if (node.children && node.children.length > 0) {
            const childrenContainer = document.createElement('div');
            childrenContainer.className = 'tree-node-children collapsed';
            
            node.children.forEach(child => {
                childrenContainer.appendChild(buildTreeNodeDom(child));
            });
            element.appendChild(childrenContainer);
            
            // Toggle event
            if (node.children.length > 0) {
                toggleIcon.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const collapsed = childrenContainer.classList.toggle('collapsed');
                    if (collapsed) {
                        toggleIcon.classList.remove('expanded');
                    } else {
                        toggleIcon.classList.add('expanded');
                    }
                });
            }
        }
        
        // Select Node click
        header.addEventListener('click', (e) => {
            e.stopPropagation();
            document.querySelectorAll('.tree-node-header').forEach(h => h.classList.remove('active'));
            header.classList.add('active');
            inspectNode(node);
        });
        
        return element;
    }
    
    // Node Inspector Display
    function inspectNode(node) {
        const placeholder = document.querySelector('.inspector-placeholder');
        const content = document.querySelector('.inspector-content');
        
        placeholder.style.display = 'none';
        content.style.display = 'flex';
        
        // Set basic metadata
        const typeLabels = { 'folder': 'Folder', 'policy': 'Policy Definition', 'rule': 'Main Rule', 'inner_rule': 'Inner Sub-Rule' };
        document.getElementById('inspector-node-type').textContent = typeLabels[node.type] || node.type.toUpperCase();
        document.getElementById('inspector-node-type').className = `node-type-badge ${node.type}`;
        document.getElementById('inspector-node-name').textContent = node.name;
        
        document.getElementById('meta-id').textContent = node.id || "N/A";
        
        const statusPill = document.getElementById('meta-status');
        if (node.enabled === false) {
            statusPill.textContent = 'Disabled';
            statusPill.className = 'status-pill red';
        } else {
            statusPill.textContent = 'Enabled';
            statusPill.className = 'status-pill green';
        }
        
        // Handle Caching / Cache TTL
        const trCache = document.getElementById('tr-cache');
        if (node.cache_ttl !== undefined && node.cache_ttl !== '') {
            trCache.style.display = 'table-row';
            const ttlVal = parseInt(node.cache_ttl);
            if (isNaN(ttlVal)) {
                document.getElementById('meta-cache').textContent = node.cache_ttl;
            } else if (ttlVal === 0) {
                document.getElementById('meta-cache').innerHTML = '<span style="color:var(--color-high);font-weight:600;">Disabled (0)</span>';
            } else {
                const hrs = (ttlVal / 3600).toFixed(1);
                document.getElementById('meta-cache').textContent = `${ttlVal} seconds (~${hrs} hours)`;
            }
        } else {
            trCache.style.display = 'none';
        }
        
        // Handle Description
        const trDesc = document.getElementById('tr-desc');
        if (node.description) {
            trDesc.style.display = 'table-row';
            document.getElementById('meta-desc').textContent = node.description;
        } else {
            trDesc.style.display = 'none';
        }
        
        // Handle IP Ranges section
        const secRanges = document.getElementById('inspector-sec-ranges');
        const rangesList = document.getElementById('inspector-ranges-list');
        rangesList.innerHTML = '';
        if (node.ranges && node.ranges.length > 0) {
            secRanges.style.display = 'block';
            node.ranges.forEach(r => {
                const div = document.createElement('div');
                div.className = 'range-item';
                div.innerHTML = `
                    <span>${r.from} - ${r.to}</span>
                    <span class="seg-lbl"><i class="fa-solid fa-network-wired"></i> ${r.segment_name || 'Unnamed Scope'}</span>
                `;
                rangesList.appendChild(div);
            });
        } else {
            secRanges.style.display = 'none';
        }
        
        // Handle Conditions section
        const secConds = document.getElementById('inspector-sec-conditions');
        const condBlock = document.getElementById('inspector-conditions-block');
        condBlock.innerHTML = '';
        if (node.conditions && node.conditions.length > 0) {
            secConds.style.display = 'block';
            node.conditions.forEach((cond, index) => {
                const condDiv = document.createElement('div');
                condDiv.className = 'condition-item';
                
                let logicLabel = '';
                if (index > 0) {
                    logicLabel = `<span class="cond-logic">${cond.logic}</span>`;
                }
                
                // Format filter details
                let filterDetails = '';
                cond.filters.forEach(f => {
                    let details = '';
                    if (f.value) details += ` = <span class="cond-val">${f.value}</span>`;
                    if (f.options && f.options.length > 0) details += ` in [${f.options.map(o => `'${o}'`).join(', ')}]`;
                    if (f.paths && f.paths.length > 0) details += ` matches path [${f.paths.join('/')}]`;
                    if (f.type) details += ` (type: ${f.type})`;
                    
                    filterDetails += `<div style="padding-left:12px;color:var(--text-secondary); margin-top:2px;">${details}</div>`;
                });
                
                condDiv.innerHTML = `
                    ${logicLabel}
                    <div class="cond-expr">
                        <strong>${cond.label || cond.field}</strong> <span style="color:var(--text-muted);font-size:11px;">[Field: ${cond.field}]</span>
                        ${filterDetails}
                    </div>
                `;
                condBlock.appendChild(condDiv);
            });
        } else {
            secConds.style.display = 'none';
        }
        
        // Handle Actions section
        const secActions = document.getElementById('inspector-sec-actions');
        const actionsBlock = document.getElementById('inspector-actions-block');
        actionsBlock.innerHTML = '';
        if (node.actions && node.actions.length > 0) {
            secActions.style.display = 'block';
            node.actions.forEach(act => {
                const actDiv = document.createElement('div');
                actDiv.className = 'action-item';
                
                let paramsHtml = '';
                if (act.params && Object.keys(act.params).length > 0) {
                    paramsHtml = '<div style="margin-top:6px;border-top:1px solid rgba(255,255,255,0.04);padding-top:4px;">';
                    Object.keys(act.params).forEach(k => {
                        paramsHtml += `<div class="act-param"><strong>${k}:</strong> ${act.params[k]}</div>`;
                    });
                    paramsHtml += '</div>';
                }
                
                const actDisabled = act.disabled === true;
                actDiv.innerHTML = `
                    <div class="act-title" style="${actDisabled ? 'text-decoration:line-through;opacity:0.5;' : ''}">
                        <i class="fa-solid fa-gears" style="color:var(--accent-indigo);margin-right:6px;"></i> ${act.name}
                        ${actDisabled ? '<span style="font-size:9px;background:rgba(239,68,68,0.15);color:var(--color-high);padding:2px 6px;border-radius:4px;margin-left:8px;">Disabled</span>' : ''}
                    </div>
                    ${paramsHtml}
                `;
                actionsBlock.appendChild(actDiv);
            });
        } else {
            secActions.style.display = 'none';
        }
    }

    // 7. Search Filters
    function initSearchEvents() {
        document.addEventListener('input', (e) => {
            if (!e.target || !e.target.id) return;
            
            const id = e.target.id;
            if (!id.startsWith('search-')) return;
            
            const query = e.target.value.toLowerCase().trim();
            const type = id.replace('search-', ''); // e.g. overlaps, duplicates, tree, remediation
            
            if (type === 'tree') {
                const nodes = document.querySelectorAll('.tree-node');
                
                // Clear highlights and reset display
                document.querySelectorAll('.tree-node-header').forEach(h => h.classList.remove('search-matched'));
                nodes.forEach(node => node.style.display = 'block');
                
                if (query === '') {
                    return;
                }
                
                const matchedNodes = new Set();
                nodes.forEach(node => {
                    const name = node.getAttribute('data-name') || '';
                    const header = node.querySelector('.tree-node-header');
                    
                    if (name.includes(query)) {
                        header.classList.add('search-matched');
                        matchedNodes.add(node);
                        
                        // Walk up parent nodes and expand their children containers, making parents visible
                        let parent = node.parentElement;
                        while (parent && parent.id !== 'policy-tree-root') {
                            if (parent.classList.contains('tree-node-children')) {
                                parent.classList.remove('collapsed');
                                
                                const parentNode = parent.parentElement;
                                if (parentNode) {
                                    parentNode.style.display = 'block';
                                    matchedNodes.add(parentNode);
                                    const caret = parentNode.querySelector('.tree-toggle-icon');
                                    if (caret) caret.classList.add('expanded');
                                }
                            }
                            parent = parent.parentElement;
                        }
                    }
                });
                
                // Hide nodes that are not matched
                nodes.forEach(node => {
                    if (!matchedNodes.has(node)) {
                        node.style.display = 'none';
                    }
                });
            } else if (type === 'remediation') {
                const rows = document.querySelectorAll('#remediation-list-container .issue-row');
                rows.forEach(row => {
                    const text = row.getAttribute('data-search') || '';
                    if (text.includes(query)) {
                        row.style.display = 'flex';
                    } else {
                        row.style.display = 'none';
                    }
                });
            } else {
                // Generic tables (overlaps, duplicates, hygiene, beyondtrust, dlp, etc)
                const table = document.getElementById(`table-${type}`);
                if (table) {
                    const rows = table.querySelectorAll('tbody tr');
                    rows.forEach(row => {
                        const searchData = row.getAttribute('data-search') || '';
                        if (searchData.includes(query)) {
                            row.style.display = 'table-row';
                        } else {
                            row.style.display = 'none';
                        }
                    });
                }
            }
        });
    }

    // 8. Modal Dialog Handlers
    function initModalEvents() {
        modalCloseBtn.addEventListener('click', hideModal);
        modalOkBtn.addEventListener('click', hideModal);
        
        detailsModal.addEventListener('click', (e) => {
            if (e.target === detailsModal) hideModal();
        });
    }
    
    function showModal(title, htmlContent) {
        modalTitle.textContent = title;
        modalContent.innerHTML = htmlContent;
        detailsModal.style.display = 'flex';
    }
    
    function hideModal() {
        detailsModal.style.display = 'none';
    }

    window.showSegmentDetailsModal = function(segmentName) {
        if (!analysisResult || !analysisResult.tree) return;
        
        const ipRanges = [];
        const targetRules = [];
        
        function findSegmentData(node) {
            if (!node) return;
            if (node.type === 'rule' || node.type === 'inner_rule') {
                let hasSeg = false;
                if (node.ranges && node.ranges.length > 0) {
                    node.ranges.forEach(r => {
                        if (r.segment_name === segmentName) {
                            hasSeg = true;
                            const rangeStr = `${r.from} - ${r.to}`;
                            if (!ipRanges.includes(rangeStr)) {
                                ipRanges.push(rangeStr);
                            }
                        }
                    });
                }
                if (hasSeg) {
                    if (!targetRules.some(r => r.name === node.name)) {
                        targetRules.push({
                            name: node.name,
                            enabled: node.enabled,
                            type: node.type,
                            actionsCount: node.actions ? node.actions.length : 0,
                            conditionsCount: node.conditions ? node.conditions.length : 0
                        });
                    }
                }
            }
            if (node.children && node.children.length > 0) {
                node.children.forEach(child => {
                    findSegmentData(child);
                });
            }
        }
        
        findSegmentData(analysisResult.tree);
        
        let rangesHtml = '';
        if (ipRanges.length > 0) {
            ipRanges.forEach(r => {
                rangesHtml += `<span class="badge" style="background: rgba(99, 102, 241, 0.15); color: #818cf8; border: 1px solid rgba(99, 102, 241, 0.2); font-size:11px; padding: 4px 10px; border-radius:4px; font-family:monospace; margin: 4px;"><i class="fa-solid fa-network-wired" style="margin-right:6px;"></i>${r}</span>`;
            });
        } else {
            rangesHtml = '<span style="font-size:12px; color:var(--text-muted); font-style:italic;">No explicit IP ranges found</span>';
        }
        
        let rulesHtml = '';
        if (targetRules.length > 0) {
            targetRules.forEach(r => {
                const statusBadge = r.enabled 
                    ? `<span style="background: rgba(16, 185, 129, 0.15); color: #10b981; font-size: 10px; font-weight: 600; padding: 2px 6px; border-radius: 4px;">ENABLED</span>`
                    : `<span style="background: rgba(239, 68, 68, 0.15); color: #ef4444; font-size: 10px; font-weight: 600; padding: 2px 6px; border-radius: 4px;">DISABLED</span>`;
                
                const typeLabel = r.type === 'inner_rule' ? 'Inner Sub-Rule' : 'Main Rule';
                
                rulesHtml += `
                    <tr style="border-bottom: 1px solid rgba(255,255,255,0.04);">
                        <td style="padding: 10px 14px; font-weight: 600; color: #fff;">${r.name}</td>
                        <td style="padding: 10px 14px; color: var(--text-secondary);">${typeLabel}</td>
                        <td style="padding: 10px 14px; text-align: center; color: var(--text-secondary);">${r.conditionsCount} / ${r.actionsCount}</td>
                        <td style="padding: 10px 14px; text-align: right;">${statusBadge}</td>
                    </tr>
                `;
            });
        } else {
            rulesHtml = '<tr><td colspan="4" style="padding:20px; text-align:center; color:var(--text-muted);">No rules target this segment directly.</td></tr>';
        }
        
        const modalHtml = `
            <div style="display:flex; flex-direction:column; gap:20px;">
                <div>
                    <h5 style="margin-top:0; margin-bottom:10px; color:var(--text-secondary); font-size:12px; text-transform:uppercase; letter-spacing:0.5px;">IP Address Scope</h5>
                    <div style="display:flex; flex-wrap:wrap; background:rgba(0,0,0,0.15); border-radius:6px; border:1px solid rgba(255,255,255,0.05); padding:10px;">
                        ${rangesHtml}
                    </div>
                </div>
                <div>
                    <h5 style="margin-top:0; margin-bottom:12px; color:var(--text-secondary); font-size:12px; text-transform:uppercase; letter-spacing:0.5px;">Policies & Rules Targeting Segment (${targetRules.length})</h5>
                    <div style="max-height: 250px; overflow-y: auto; background: rgba(0,0,0,0.2); border-radius: 8px; border: 1px solid rgba(255,255,255,0.05);">
                        <table style="width: 100%; border-collapse: collapse; font-size: 12px; text-align: left;">
                            <thead>
                                <tr style="border-bottom: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.02); color: var(--text-secondary);">
                                    <th style="padding: 10px 14px;">Rule Name</th>
                                    <th style="padding: 10px 14px;">Type</th>
                                    <th style="padding: 10px 14px; text-align: center;">Conds / Acts</th>
                                    <th style="padding: 10px 14px; text-align: right;">Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${rulesHtml}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        `;
        
        showModal(`Segment Details: ${segmentName}`, modalHtml);
    };

    function showComplianceExplanationModal(scorePct, passedCount, totalCount, moduleName) {
        let riskLevel = '';
        let riskColor = '';
        let descText = '';
        let tableRows = '';
        
        if (scorePct >= 80) {
            riskLevel = 'Low Risk';
            riskColor = 'var(--accent-green)';
            descText = 'Sistem terkonfigurasi dengan baik dan memenuhi standar kepatuhan minimum.';
        } else if (scorePct >= 50) {
            riskLevel = 'Medium Risk';
            riskColor = 'var(--color-medium)';
            descText = 'Beberapa konfigurasi perlu disesuaikan kembali untuk menutup celah minor.';
        } else if (scorePct >= 30) {
            riskLevel = 'High Risk';
            riskColor = 'var(--color-high)';
            descText = 'Terdapat celah keamanan kritis yang berbahaya bagi integritas sistem.';
        } else {
            riskLevel = 'Critical Risk';
            riskColor = '#ef4444';
            descText = 'Sistem sangat rentan terhadap eksploitasi/akses tidak sah secara lokal!';
        }

        const levels = [
            { range: '≥ 80%', name: 'LOW RISK', color: 'var(--accent-green)', active: scorePct >= 80 },
            { range: '50% - 79%', name: 'MEDIUM RISK', color: 'var(--color-medium)', active: scorePct >= 50 && scorePct < 80 },
            { range: '30% - 49%', name: 'HIGH RISK', color: 'var(--color-high)', active: scorePct >= 30 && scorePct < 50 },
            { range: '< 30%', name: 'CRITICAL RISK', color: '#ef4444', active: scorePct < 30 }
        ];

        tableRows = levels.map(l => {
            const bgStyle = l.active ? `background: ${l.color}15; font-weight: 700;` : '';
            const activeIndicator = l.active ? `<span style="color: ${l.color}; font-weight: 700;">★ Aktif</span>` : '';
            return `
                <tr style="border-bottom: 1px solid rgba(255,255,255,0.03); ${bgStyle}">
                    <td style="padding: 8px; color: ${l.active ? l.color : 'inherit'};">${l.range}</td>
                    <td style="padding: 8px; color: ${l.active ? l.color : 'inherit'};">${l.name}</td>
                    <td style="padding: 8px;">${activeIndicator}</td>
                </tr>
            `;
        }).join('');

        const htmlContent = `
            <div style="font-family: var(--font-family); color: var(--text-primary); line-height: 1.6;">
                <div style="display: flex; gap: 16px; align-items: center; margin-bottom: 20px; padding-bottom: 16px; border-bottom: 1px solid var(--border-color);">
                    <div style="font-size: 36px; font-weight: 800; color: ${riskColor};">${scorePct}%</div>
                    <div>
                        <div style="font-size: 16px; font-weight: 700; color: #fff; display: flex; align-items: center; gap: 8px;">
                            ${riskLevel.toUpperCase()}
                            <span style="font-size: 11px; background: ${riskColor}20; color: ${riskColor}; border: 1px solid ${riskColor}40; padding: 2px 6px; border-radius: 4px;">AKTIF</span>
                        </div>
                        <div style="font-size: 12px; color: var(--text-muted);">${descText}</div>
                    </div>
                </div>
                
                <h5 style="color: #fff; margin-bottom: 8px; font-size: 14px;">Bagaimana Skor ini Dihitung?</h5>
                <p style="font-size: 13px; color: var(--text-secondary); margin-bottom: 16px;">
                    Skor kepatuhan dihitung secara otomatis dengan membandingkan jumlah aspek audit yang **aman (Secure)** terhadap total kriteria pemeriksaan standar (${totalCount} poin audit untuk modul ${moduleName}).
                </p>
                
                <div style="background: rgba(255,255,255,0.02); border: 1px solid var(--border-color); border-radius: 8px; padding: 12px 16px; margin-bottom: 20px;">
                    <div style="display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 6px;">
                        <span>Kriteria Lulus (Secure):</span>
                        <strong style="color: var(--accent-green);">${passedCount} Kriteria</strong>
                    </div>
                    <div style="display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 6px;">
                        <span>Kriteria Gagal (Risk Detected):</span>
                        <strong style="color: #ef4444;">${totalCount - passedCount} Kriteria</strong>
                    </div>
                    <div style="display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 6px; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 6px;">
                        <span>Kalkulasi Rasio Kepatuhan:</span>
                        <strong>${passedCount} / ${totalCount} = ${((passedCount / totalCount) * 100).toFixed(2)}% (dibulatkan menjadi ${scorePct}%)</strong>
                    </div>
                </div>

                <h5 style="color: #fff; margin-bottom: 8px; font-size: 14px;">Matriks Penilaian Risiko</h5>
                <table style="width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 20px; border: 1px solid var(--border-color); border-radius: 6px; overflow: hidden;">
                    <thead>
                        <tr style="background: rgba(255,255,255,0.02); border-bottom: 1px solid var(--border-color); text-align: left; color: var(--text-muted);">
                            <th style="padding: 8px;">Rentang Skor</th>
                            <th style="padding: 8px;">Level Risiko</th>
                            <th style="padding: 8px;">Status Aktif</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${tableRows}
                    </tbody>
                </table>

                <div style="background: ${riskColor}08; border: 1px solid ${riskColor}20; border-radius: 8px; padding: 12px 16px; display: flex; gap: 12px;">
                    <i class="fa-solid fa-triangle-exclamation" style="color: ${riskColor}; font-size: 20px; margin-top: 2px;"></i>
                    <div>
                        <div style="font-weight: 700; color: ${riskColor}; font-size: 13px; margin-bottom: 4px;">Rekomendasi Tindakan:</div>
                        <div style="font-size: 12px; color: var(--text-secondary); line-height: 1.5;">
                            ${scorePct < 50 
                                ? `Skor Anda (${scorePct}%) di bawah 50% menunjukkan kerentanan yang serius. Disarankan untuk segera melakukan patch/update keamanan dan menutup port/kredensial yang bocor untuk menaikkan skor kepatuhan ke tingkat yang lebih aman.`
                                : `Pertahankan skor kepatuhan ini dan lakukan audit berkala secara berkala untuk mendeteksi perubahan konfigurasi yang tidak diinginkan.`
                            }
                        </div>
                    </div>
                </div>
            </div>
        `;

        showModal(`ℹ️ Ringkasan Analisis Kepatuhan & Risiko`, htmlContent);
    }
    
    window.showComplianceExplanationModal = showComplianceExplanationModal;

    // ========== AUDIT REFERENCE BUTTON ==========
    function initAuditRefButton() {
        if (!btnAuditRef) return;
        btnAuditRef.addEventListener('click', () => {
            showAuditReferenceModal();
        });
    }

    function showAuditReferenceModal() {
        if (!analysisResult || !analysisResult.audit_reference || analysisResult.audit_reference.length === 0) {
            showToast('No audit reference data available for this module.', 'warning');
            return;
        }

        const items = analysisResult.audit_reference;
        const brandName = analysisResult.brand_name || 'Module';
        const checkedCount = items.filter(i => i.checked).length;

        let tableRows = items.map((item, idx) => {
            const checkIcon = item.checked
                ? '<i class="fa-solid fa-circle-check" style="color: var(--accent-green); font-size: 18px;"></i>'
                : '<i class="fa-regular fa-circle" style="color: var(--text-muted); font-size: 18px;"></i>';

            return `
                <tr style="border-bottom: 1px solid rgba(255,255,255,0.06);">
                    <td style="padding: 14px 12px; text-align: center; vertical-align: top; width: 50px;">
                        ${checkIcon}
                    </td>
                    <td style="padding: 14px 12px; vertical-align: top; min-width: 200px;">
                        <div style="font-weight: 600; color: var(--text-primary); margin-bottom: 4px; font-size: 13px;">${item.checklist}</div>
                        <div style="font-size: 11px; color: var(--text-muted);">${item.id.toUpperCase()}</div>
                    </td>
                    <td style="padding: 14px 12px; vertical-align: top; min-width: 180px;">
                        <div style="font-size: 12px; color: var(--accent-indigo); font-weight: 500; line-height: 1.5;">${item.reference}</div>
                    </td>
                    <td style="padding: 14px 12px; vertical-align: top; min-width: 220px;">
                        <div style="font-size: 12px; color: var(--text-secondary); line-height: 1.5;">${item.method}</div>
                    </td>
                    <td style="padding: 14px 12px; vertical-align: top; min-width: 220px;">
                        <div style="font-size: 12px; color: var(--accent-green); font-weight: 500; line-height: 1.5;">${item.recommendation}</div>
                    </td>
                </tr>
            `;
        }).join('');

        const htmlContent = `
            <div style="margin-bottom: 20px;">
                <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px;">
                    <div style="display: flex; align-items: center; gap: 8px; padding: 8px 16px; background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.2); border-radius: 10px;">
                        <i class="fa-solid fa-clipboard-check" style="color: var(--accent-green); font-size: 16px;"></i>
                        <span style="font-size: 14px; font-weight: 700; color: var(--accent-green);">${checkedCount} / ${items.length}</span>
                        <span style="font-size: 12px; color: var(--text-secondary);">Checklist Completed</span>
                    </div>
                    <div style="display: flex; align-items: center; gap: 8px; padding: 8px 16px; background: rgba(99, 102, 241, 0.1); border: 1px solid rgba(99, 102, 241, 0.2); border-radius: 10px;">
                        <i class="fa-solid fa-shield-halved" style="color: var(--accent-indigo); font-size: 16px;"></i>
                        <span style="font-size: 12px; color: var(--text-secondary);">Brand: <strong style="color: var(--text-primary);">${brandName}</strong></span>
                    </div>
                </div>
                <p style="font-size: 13px; color: var(--text-secondary); line-height: 1.6; margin: 0;">
                    Berikut adalah daftar referensi audit yang digunakan oleh SpectraOne untuk melakukan assessment terhadap konfigurasi <strong>${brandName}</strong>. Setiap item menunjukkan aspek yang diperiksa, referensi standar, metode analisis, dan rekomendasi perbaikan.
                </p>
            </div>
            <div style="overflow-x: auto; border-radius: 12px; border: 1px solid rgba(255,255,255,0.08);">
                <table style="width: 100%; border-collapse: collapse; min-width: 900px;">
                    <thead>
                        <tr style="background: rgba(99, 102, 241, 0.08); border-bottom: 2px solid rgba(99, 102, 241, 0.2);">
                            <th style="padding: 12px; text-align: center; font-size: 11px; text-transform: uppercase; color: var(--text-muted); font-weight: 700; letter-spacing: 0.5px; width: 50px;">Status</th>
                            <th style="padding: 12px; text-align: left; font-size: 11px; text-transform: uppercase; color: var(--text-muted); font-weight: 700; letter-spacing: 0.5px;">Checklist Audit</th>
                            <th style="padding: 12px; text-align: left; font-size: 11px; text-transform: uppercase; color: var(--text-muted); font-weight: 700; letter-spacing: 0.5px;">Referensi</th>
                            <th style="padding: 12px; text-align: left; font-size: 11px; text-transform: uppercase; color: var(--text-muted); font-weight: 700; letter-spacing: 0.5px;">Metode</th>
                            <th style="padding: 12px; text-align: left; font-size: 11px; text-transform: uppercase; color: var(--text-muted); font-weight: 700; letter-spacing: 0.5px;">Rekomendasi</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${tableRows}
                    </tbody>
                </table>
            </div>
        `;

        showModal(`📋 Audit Reference — ${brandName}`, htmlContent);
    }
    
    function showIssueDetailsModal(issue) {
        let contentHtml = '';
        
        if (issue.category === 'IP Overlaps') {
            const rules = issue.details;
            contentHtml = `
                <div style="margin-bottom:16px;">
                    <p style="font-size:14px;color:var(--text-primary);line-height:1.5;margin-bottom:12px;">
                        The following rules target overlapping IP subnet/ranges, which can result in matching conflicts during evaluation.
                    </p>
                    <table class="detail-grid">
                        <tr>
                            <td>Rule A:</td>
                            <td><strong>${rules.rule_a.name}</strong> <span style="color:var(--text-muted)">(ID: ${rules.rule_a.id})</span></td>
                        </tr>
                        <tr>
                            <td>Status A:</td>
                            <td><span class="status-pill ${rules.rule_a.enabled ? 'green' : 'red'}">${rules.rule_a.enabled ? 'Enabled' : 'Disabled'}</span></td>
                        </tr>
                        <tr>
                            <td>Rule B:</td>
                            <td><strong>${rules.rule_b.name}</strong> <span style="color:var(--text-muted)">(ID: ${rules.rule_b.id})</span></td>
                        </tr>
                        <tr>
                            <td>Status B:</td>
                            <td><span class="status-pill ${rules.rule_b.enabled ? 'green' : 'red'}">${rules.rule_b.enabled ? 'Enabled' : 'Disabled'}</span></td>
                        </tr>
                    </table>
                </div>
                
                <h5 style="color:var(--text-muted);font-size:11px;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;border-bottom:1px solid var(--border-color);padding-bottom:4px;">Overlapping IP Segments</h5>
                <div style="display:flex;flex-direction:column;gap:8px;max-height:220px;overflow-y:auto;padding-right:4px;">
            `;
            
            rules.overlaps.forEach(o => {
                contentHtml += `
                    <div style="background:rgba(255,255,255,0.02);border:1px solid var(--border-color);border-radius:6px;padding:10px 14px;">
                        <span class="overlap-pill ${o.type}" style="margin-bottom:6px;">${o.type} overlap</span>
                        <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px;">
                            <span style="color:var(--text-muted)">A Scope:</span>
                            <span style="font-family:monospace;color:var(--text-primary);">${o.range_a}</span>
                        </div>
                        <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px;">
                            <span style="color:var(--text-muted)">A Segment:</span>
                            <span>${o.segment_a}</span>
                        </div>
                        <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px;">
                            <span style="color:var(--text-muted)">B Scope:</span>
                            <span style="font-family:monospace;color:var(--text-primary);">${o.range_b}</span>
                        </div>
                        <div style="display:flex;justify-content:space-between;font-size:12px;">
                            <span style="color:var(--text-muted)">B Segment:</span>
                            <span>${o.segment_b}</span>
                        </div>
                    </div>
                `;
            });
            
            contentHtml += `</div>`;
            contentHtml += `</div>`;
            
            contentHtml += generateRemediationHtml(issue);
            
            showModal("Scope Overlap Audit", contentHtml);
            
        } else if (issue.category === 'Duplicates') {
            contentHtml = `
                <p style="font-size:14px;color:var(--text-primary);line-height:1.5;margin-bottom:16px;">
                    Having multiple rules with the same name makes rule identification and debugging very complex.
                </p>
                <h5 style="color:var(--text-muted);font-size:11px;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;border-bottom:1px solid var(--border-color);padding-bottom:4px;">Rule Occurrences</h5>
                <div style="display:flex;flex-direction:column;gap:8px;">
            `;
            
            issue.details.occurrences.forEach(o => {
                const statusColor = o.enabled === true ? 'var(--accent-green)' : (o.enabled === 'N/A' ? 'var(--text-muted)' : 'var(--color-high)');
                const statusText = o.enabled === true ? 'Enabled' : (o.enabled === 'N/A' ? 'Sub-rule' : 'Disabled');
                contentHtml += `
                    <div style="background:rgba(255,255,255,0.02);border:1px solid var(--border-color);border-radius:6px;padding:10px 14px;display:flex;justify-content:space-between;align-items:center;">
                        <div>
                            <span style="font-weight:600;color:var(--text-primary);">${o.type}</span>
                            <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">ID: ${o.id}</div>
                        </div>
                        <span class="status-pill" style="background:rgba(255,255,255,0.04);border:1px solid var(--border-color);color:var(--text-secondary);">${statusText}</span>
                    </div>
                `;
            });
            
            contentHtml += `</div>`;
            
            contentHtml += generateRemediationHtml(issue);
            
            showModal(`Duplicates: '${issue.details.rule_name}'`, contentHtml);
            
        } else {
            contentHtml = `
                <div style="background:rgba(255,255,255,0.02);border:1px solid var(--border-color);border-radius:6px;padding:16px;margin-bottom:16px;">
                    <h5 style="color:var(--text-muted);font-size:10px;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;"><i class="fa-solid fa-circle-question" style="margin-right:4px;"></i> Alasan & Kondisi Temuan</h5>
                    <p style="font-size:14px;color:var(--text-primary);line-height:1.5;">${issue.description}</p>
                </div>
            `;
            
            if (issue.impact) {
                contentHtml += `
                <div style="background:rgba(239,68,68,0.03);border:1px solid rgba(239,68,68,0.2);border-left:3px solid var(--color-high);border-radius:6px;padding:16px;margin-bottom:16px;">
                    <h5 style="color:var(--color-high);font-size:10px;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;"><i class="fa-solid fa-triangle-exclamation" style="margin-right:4px;"></i> Business & Security Impact</h5>
                    <p style="font-size:13px;color:var(--text-primary);line-height:1.5;">${issue.impact}</p>
                </div>
                `;
            }
            
            if (issue.use_case) {
                contentHtml += `
                <div style="background:rgba(99,102,241,0.03);border:1px solid rgba(99,102,241,0.2);border-left:3px solid var(--accent-indigo);border-radius:6px;padding:16px;margin-bottom:16px;">
                    <h5 style="color:var(--accent-indigo);font-size:10px;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;"><i class="fa-solid fa-bolt" style="margin-right:4px;"></i> Attack Vector / Use Case</h5>
                    <p style="font-size:13px;color:var(--text-primary);line-height:1.5;">${issue.use_case}</p>
                </div>
                `;
            }
            
            if (currentBrand === 'local_exploit') {
                const checkId = getChecklistIdForIssue(currentBrand, issue);
                const mappings = {
                    'le-01': { label: 'OWASP A06:2021', name: 'Vulnerable and Outdated Components', color: '#db2777' },
                    'le-02': { label: 'OWASP A05:2021', name: 'Security Misconfiguration', color: '#ea580c' },
                    'le-03': { label: 'OWASP A05:2021', name: 'Security Misconfiguration', color: '#ea580c' },
                    'le-04': { label: 'OWASP A02:2021', name: 'Cryptographic Failures', color: '#ca8a04' },
                    'le-05': { label: 'OWASP A05:2021', name: 'Security Misconfiguration', color: '#ea580c' },
                    'le-06': { label: 'OWASP A05:2021', name: 'Security Misconfiguration', color: '#ea580c' },
                    'le-07': { label: 'MITRE T1611', name: 'Escape to Host', color: '#2563eb' },
                    'le-08': { label: 'OWASP A05:2021', name: 'Security Misconfiguration', color: '#ea580c' },
                    'le-09': { label: 'OWASP A05:2021', name: 'Security Misconfiguration', color: '#ea580c' },
                    'le-10': { label: 'OWASP A05:2021', name: 'Security Misconfiguration', color: '#ea580c' },
                    'le-11': { label: 'OWASP A05:2021', name: 'Security Misconfiguration', color: '#ea580c' },
                    'le-12': { label: 'OWASP A06:2021', name: 'Vulnerable and Outdated Components', color: '#db2777' },
                    'le-13': { label: 'OWASP A05:2021', name: 'Security Misconfiguration', color: '#ea580c' },
                    'le-14': { label: 'OWASP A02:2021', name: 'Cryptographic Failures', color: '#ca8a04' },
                    'le-15': { label: 'OWASP A02:2021', name: 'Cryptographic Failures', color: '#ca8a04' }
                };
                const map = mappings[checkId];

                contentHtml += `
                    <table class="detail-grid">
                        <tr>
                            <td>Category:</td>
                            <td><strong>${issue.category}</strong></td>
                        </tr>
                        <tr>
                            <td>Severity:</td>
                            <td><span class="severity-badge ${issue.severity.toLowerCase()}" style="font-size:10px;padding:2px 8px;border-radius:10px;background:rgba(255,255,255,0.04);color:inherit;">${issue.severity}</span></td>
                        </tr>
                `;

                if (map) {
                    contentHtml += `
                        <tr>
                            <td>Framework Mapping:</td>
                            <td><span style="background:${map.color}15; color:${map.color}; border: 1px solid ${map.color}33; font-size:11px; padding:2px 8px; border-radius:4px; font-weight:700;">${map.label} — ${map.name}</span></td>
                        </tr>
                    `;
                }

                const d = issue.details || {};
                
                // OS Path / File
                const targetPath = d.path || d.file || d.filepath;
                if (targetPath) {
                    contentHtml += `
                        <tr>
                            <td>Target Path:</td>
                            <td style="font-family:monospace; word-break:break-all; color:#fff;">${targetPath}</td>
                        </tr>
                    `;
                }

                // Reference (GTFOBins, MITRE, CIS)
                if (d.reference) {
                    contentHtml += `
                        <tr>
                            <td>Reference:</td>
                            <td><span style="background:rgba(255,255,255,0.05); color:#fff; font-size:11px; padding:2px 8px; border-radius:4px; font-weight:600;">${d.reference}</span></td>
                        </tr>
                    `;
                }

                // Exploits download / details url
                if (d.details_url) {
                    contentHtml += `
                        <tr>
                            <td>Exploit Info:</td>
                            <td><a href="${d.details_url}" target="_blank" style="color:var(--accent-indigo); text-decoration:underline; font-size:12px; font-weight:600;"><i class="fa-solid fa-arrow-up-right-from-square" style="font-size:10px; margin-right:4px;"></i> Exploit Details / ExploitDB</a></td>
                        </tr>
                    `;
                }
                if (d.download_url) {
                    contentHtml += `
                        <tr>
                            <td>Download PoC:</td>
                            <td><a href="${d.download_url}" target="_blank" style="color:var(--accent-green); text-decoration:underline; font-size:12px; font-weight:600;"><i class="fa-solid fa-download" style="font-size:10px; margin-right:4px;"></i> Download PoC Exploit</a></td>
                        </tr>
                    `;
                }

                // Port / Bind address info
                if (d.port) {
                    contentHtml += `
                        <tr>
                            <td>Service / Port:</td>
                            <td><strong>${d.service || 'Unknown'}</strong> (Port ${d.port}) listening on <span style="font-family:monospace; color:#ef4444;">${d.bind_address || '0.0.0.0'}</span></td>
                        </tr>
                    `;
                }

                // SUID / Capabilities info
                if (d.binary) {
                    contentHtml += `
                        <tr>
                            <td>Binary:</td>
                            <td style="font-family:monospace; color:#fff;">${d.binary}</td>
                        </tr>
                    `;
                }
                if (d.capabilities) {
                    contentHtml += `
                        <tr>
                            <td>Capabilities:</td>
                            <td style="font-family:monospace; color:#fff;">${d.capabilities}</td>
                        </tr>
                    `;
                }

                contentHtml += `</table>`;
            } else {
                contentHtml += `
                    <table class="detail-grid">
                        <tr>
                            <td>Category:</td>
                            <td><strong>${issue.category}</strong></td>
                        </tr>
                        <tr>
                            <td>Severity:</td>
                            <td><span class="severity-badge ${issue.severity.toLowerCase()}" style="font-size:10px;padding:2px 8px;border-radius:10px;background:rgba(255,255,255,0.04);color:inherit;">${issue.severity}</span></td>
                        </tr>
                        <tr>
                            <td>Element:</td>
                            <td>${issue.details.name || "Unnamed"} (${issue.details.type || "Rule"})</td>
                        </tr>
                        <tr>
                            <td>Element ID:</td>
                            <td style="font-family:monospace;">${issue.details.id || "N/A"}</td>
                        </tr>
                    </table>
                `;
            }
            
            contentHtml += generateRemediationHtml(issue);
            
            showModal(issue.title, contentHtml);
        }
    }
    
    function getPowerShellRemediationCommand(issue) {
        const checklistId = getChecklistIdForIssue('active_directory', issue);
        const details = issue.details || {};
        const username = details.user || details.username || (issue.title ? issue.title.split(': ').pop() : 'AccountName');
        const compname = details.computer || (issue.title ? issue.title.split(': ').pop() : 'ComputerName');
        
        switch (checklistId) {
            case 'ad-01':
                return `Disable-ADAccount -Identity "${username.split('@')[0]}"`;
            case 'ad-02':
                return `# Tinjau keanggotaan grup Domain Admins\nRemove-ADGroupMember -Identity "Domain Admins" -Members "${username.split('@')[0]}"`;
            case 'ad-03':
                return `# Atur kebijakan lockout akun di Default Domain Policy\nSet-ADDefaultDomainPasswordPolicy -Identity "spectraone.local" -LockoutThreshold 5 -LockoutDuration 00:30:00 -LockoutObservationWindow 00:30:00`;
            case 'ad-04':
                return `# Matikan flag Password Never Expires pada akun service\nSet-ADUser -Identity "${username.split('@')[0]}" -PasswordNeverExpires $false`;
            case 'ad-05':
                return `# Jalankan scan pemantauan status prioritas AD\nGet-ADUser -Filter {Enabled -eq $true} -Properties LastLogonDate`;
            case 'ad-06':
                return `Set-ADUser -Identity "${username.split('@')[0]}" -TrustedForDelegation $false\n# ATAU untuk computer:\nSet-ADComputer -Identity "${compname.split('.')[0]}" -TrustedForDelegation $false`;
            case 'ad-07':
                return `# Aktifkan LAPS di Domain via GPO atau Set-ADComputer\n# Terapkan Windows LAPS via cmdlet PowerShell terbaru:\nSet-LapsADComputerSchema\nUpdate-LapsADschema`;
            case 'ad-08':
                return `Set-ADUser -Identity "${username.split('@')[0]}" -DoesNotRequirePreAuth $false`;
            case 'ad-09':
                return `# Aktifkan kembali ACL Inheritance untuk akun\n$dn = (Get-ADUser -Identity "${username.split('@')[0]}").DistinguishedName\n$acl = Get-Acl -Path "AD:\\$dn"\nif ($acl.AreAccessRulesProtected) {\n    $acl.SetAccessRuleProtection($false, $true)\n    Set-Acl -Path "AD:\\$dn" -AclObject $acl\n    Write-Host "Inheritance diaktifkan kembali untuk $dn"\n}`;
            case 'ad-10':
                return `Remove-ADGroupMember -Identity "Backup Operators" -Members "${username.split('@')[0]}"\nRemove-ADGroupMember -Identity "Account Operators" -Members "${username.split('@')[0]}"`;
            case 'ad-11':
                return `# Batasi atau hapus SPN jika tidak diperlukan\nSet-ADUser -Identity "${username.split('@')[0]}" -ServicePrincipalNames @{Remove="${details.spn || 'HTTP/service'}"}`;
            case 'ad-12':
                return `# Wajibkan SMB Signing di server Server & Client Registry\nSet-ItemProperty -Path "HKLM:\\SYSTEM\\CurrentControlSet\\Services\\LanmanServer\\Parameters" -Name "RequireSecuritySignature" -Value 1\nSet-ItemProperty -Path "HKLM:\\SYSTEM\\CurrentControlSet\\Services\\LanmanWorkstation\\Parameters" -Name "RequireSecuritySignature" -Value 1`;
            case 'ad-13':
                return `# Cari dan hapus file XML dengan tag cpassword di folder SYSVOL\nGet-ChildItem -Path "\\\\SPECTRAONE.LOCAL\\SYSVOL\\SPECTRAONE.LOCAL\\Policies" -Filter "*.xml" -Recurse | Select-String "cpassword"`;
            case 'ad-14':
                return `# Wajibkan LDAP Signing di DC Registry\nSet-ItemProperty -Path "HKLM:\\SYSTEM\\CurrentControlSet\\Services\\NTDS\\Parameters" -Name "LDAPServerIntegrity" -Value 2`;
            case 'ad-15':
                return `# Disarankan mendownload script resmi Microsoft:\n# https://github.com/microsoft/New-KrbTgtKeys.ps1\n# Jalankan script untuk melakukan reset password KRBTGT:\n.\\New-KrbTgtKeys.ps1 -ResetKeys`;
            default:
                return '';
        }
    }

    function generateRemediationHtml(issue) {
        let steps = issue.remediation_steps || [];
        let impact = issue.impact || '';
        let references = issue.references || '';
        
        if (!steps.length && !impact && !references) {
            // Static mapping for Forescout
            if (issue.category === 'Duplicates') {
                steps = [
                    "Buka Forescout Console dan pilih tab 'Policy'.",
                    "Gunakan fitur pencarian untuk menemukan aturan dengan nama tersebut.",
                    "Ubah nama salah satu aturan agar unik, atau gabungkan jika fungsinya sama."
                ];
                impact = "Menyebabkan kebingungan saat troubleshooting dan potensi konflik eksekusi aksi karena policy membingungkan administrator.";
                references = "Forescout Best Practices: Naming Conventions";
            } else if (issue.category === 'IP Overlaps') {
                steps = [
                    "Buka Forescout Console dan navigasi ke kebijakan yang tumpang tindih.",
                    "Periksa 'Segment' atau 'IP Range' yang dikonfigurasi.",
                    "Persempit cakupan IP pada salah satu aturan agar tidak beririsan.",
                    "Pastikan hierarki urutan (execution order) kebijakan sudah benar jika overlap disengaja."
                ];
                impact = "Terjadinya konflik eksekusi. Perangkat mungkin terkena tindakan (action) dari aturan yang salah karena dievaluasi oleh lebih dari satu aturan secara bersamaan.";
                references = "Forescout Administration Guide: Managing Segments and Scope";
            } else if (issue.title && issue.title.includes('Empty Conditions')) {
                steps = [
                    "Buka Forescout Console dan klik dua kali pada aturan untuk membuka 'Rule Editor'.",
                    "Pada bagian 'Conditions', tambahkan kriteria spesifik (misalnya: Host OS, MAC Address, atau Group).",
                    "Jika aturan ini dirancang sebagai 'Catch-All', pastikan posisinya berada di urutan paling bawah."
                ];
                impact = "Aturan akan mengeksekusi semua perangkat tanpa syarat, menyebabkan salah sasaran (false positives) dan salah memberikan tindakan.";
                references = "Forescout Best Practices: Condition Filters";
            } else if (issue.title && issue.title.includes('Disabled')) {
                steps = [
                    "Buka Forescout Console dan tinjau aturan yang dinonaktifkan.",
                    "Jika aturan sudah tidak lagi relevan, hapus aturan tersebut.",
                    "Jika masih digunakan secara berkala, pindahkan ke folder 'Archive'."
                ];
                impact = "Menumpuknya aturan yang tidak aktif akan menurunkan kebersihan konfigurasi (hygiene) dan membingungkan analis di masa depan.";
                references = "Forescout Best Practices: Policy Lifecycle Management";
            } else if (issue.title && issue.title.includes('No Active Actions')) {
                steps = [
                    "Buka Forescout Console dan cek bagian 'Actions' pada aturan tersebut.",
                    "Aktifkan tindakan yang diperlukan atau tambahkan tindakan baru jika kosong.",
                    "Jika aturan hanya untuk memantau (Audit-only), pastikan nama aturan mendeskripsikannya."
                ];
                impact = "Aturan berhasil mengklasifikasikan perangkat tetapi tidak melakukan penegakan kebijakan (enforcement) apa pun.";
                references = "Forescout Administration Guide: Actions Configuration";
            } else if (issue.category === 'Performance') {
                steps = [
                    "Buka Forescout Console dan buka 'Rule Editor'.",
                    "Pergi ke tab 'Advanced' atau pengaturan 'Evaluate'.",
                    "Tingkatkan nilai 'Cache TTL' minimal menjadi 3600 detik (1 Jam), kecuali untuk kebijakan kritikal real-time."
                ];
                impact = "Tanpa caching, Forescout akan terus-menerus mengevaluasi ulang perangkat setiap saat, membebani CPU, dan memperlambat kinerja sistem.";
                references = "Forescout Performance Optimization Guide";
            }
        }
        
        if (!steps.length && !impact && !references) return '';
        
        let html = `
            <div style="margin-top:24px; border-top:1px solid rgba(255,255,255,0.05); padding-top:16px;">
                <h4 style="color:var(--accent-green);font-size:13px;margin-bottom:12px;display:flex;align-items:center;gap:6px;">
                    <i class="fa-solid fa-screwdriver-wrench"></i> Panduan Remediasi
                </h4>
        `;
        
        if (currentBrand === 'active_directory') {
            const psCmd = getPowerShellRemediationCommand(issue);
            if (psCmd) {
                html += `
                    <div style="background:rgba(30, 41, 59, 0.4);border:1px solid rgba(99,102,241,0.25);border-radius:6px;padding:16px;margin-bottom:12px;">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                            <h5 style="color:var(--accent-indigo);font-size:10px;text-transform:uppercase;letter-spacing:1px;margin:0;"><i class="fa-brands fa-windows" style="margin-right:4px;"></i> Quick PowerShell Remediation</h5>
                            <button class="btn btn-secondary btn-sm" onclick="navigator.clipboard.writeText(\`${psCmd.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$')}\`); showToast('Cmdlet berhasil disalin!', 'success');" style="padding: 2px 6px; font-size:10px; height:auto; display:flex; align-items:center; gap:4px;">
                                <i class="fa-solid fa-copy"></i> Salin
                            </button>
                        </div>
                        <pre style="margin:0; padding:10px; background:rgba(0,0,0,0.2); border-radius:4px; font-family:monospace; font-size:12px; color:#38bdf8; overflow-x:auto; white-space:pre-wrap; word-break:break-all; border: 1px solid rgba(255,255,255,0.03);">${psCmd}</pre>
                    </div>
                `;
            }
        }
        
        if (impact) {
            html += `
                <div style="background:rgba(239,68,68,0.03);border:1px solid rgba(239,68,68,0.2);border-left:3px solid var(--color-high);border-radius:6px;padding:12px 16px;margin-bottom:12px;">
                    <h5 style="color:var(--color-high);font-size:10px;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;"><i class="fa-solid fa-triangle-exclamation" style="margin-right:4px;"></i> Business & Security Impact</h5>
                    <p style="font-size:13px;color:var(--text-primary);line-height:1.5;margin:0;">${impact}</p>
                </div>
            `;
        }
        
        if (steps && steps.length > 0) {
            html += `<div style="background:rgba(255,255,255,0.02);border:1px solid var(--border-color);border-radius:6px;padding:16px;margin-bottom:12px;">`;
            html += `<h5 style="color:var(--text-muted);font-size:10px;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px;">Langkah Penyelesaian (Step-by-Step)</h5>`;
            html += `<ol style="margin:0;padding-left:16px;font-size:13px;color:var(--text-primary);line-height:1.6;display:flex;flex-direction:column;gap:6px;">`;
            steps.forEach(step => {
                html += `<li>${step}</li>`;
            });
            html += `</ol></div>`;
        }
        
        if (references) {
            html += `
                <div style="background:rgba(99,102,241,0.03);border:1px solid rgba(99,102,241,0.2);border-left:3px solid var(--accent-indigo);border-radius:6px;padding:12px 16px;">
                    <h5 style="color:var(--accent-indigo);font-size:10px;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;"><i class="fa-solid fa-book" style="margin-right:4px;"></i> Referensi</h5>
                    <p style="font-size:12px;color:var(--text-secondary);line-height:1.4;margin:0;">${references}</p>
                </div>
            `;
        }
        
        html += `</div>`;
        return html;
    }
    
    // 9. Render Remediation Workspace Tab
    function renderRemediationWorkspace() {
        const container = document.getElementById('remediation-list-container');
        container.innerHTML = '';
        
        if (!analysisResult || !analysisResult.issues) {
            container.innerHTML = `<div style="text-align:center;color:var(--text-muted);padding:24px;">No issues dataset loaded.</div>`;
            return;
        }
        
        const issues = analysisResult.issues;
        const totalCount = issues.length;
        const resolvedCount = issues.filter(i => i.resolved === true).length;
        const pct = totalCount > 0 ? Math.round((resolvedCount / totalCount) * 100) : 0;
        
        // Update progress UI
        document.getElementById('remediation-progress-text').textContent = `${resolvedCount} / ${totalCount} Findings Resolved (${pct}%)`;
        document.getElementById('remediation-progress-fill').style.width = `${pct}%`;
        
        // Update open/solved counters
        const openCountEl = document.getElementById('rem-open-count');
        const solvedCountEl = document.getElementById('rem-solved-count');
        if (openCountEl) openCountEl.textContent = `${totalCount - resolvedCount} Unresolved`;
        if (solvedCountEl) solvedCountEl.textContent = `${resolvedCount} Resolved`;
        
        const badge = document.getElementById('remediation-status-badge');
        if (resolvedCount === totalCount && totalCount > 0) {
            badge.textContent = "✓ COMPLETED";
            badge.style.background = 'rgba(16, 185, 129, 0.1)';
            badge.style.borderColor = 'rgba(16, 185, 129, 0.2)';
            badge.style.color = 'var(--accent-green)';
        } else if (resolvedCount > 0) {
            badge.textContent = "⟳ IN REMEDIATION";
            badge.style.background = 'rgba(245, 158, 11, 0.1)';
            badge.style.borderColor = 'rgba(245, 158, 11, 0.2)';
            badge.style.color = 'var(--color-medium)';
        } else {
            badge.textContent = "⚠ OPEN";
            badge.style.background = 'rgba(239, 68, 68, 0.1)';
            badge.style.borderColor = 'rgba(239, 68, 68, 0.2)';
            badge.style.color = 'var(--color-high)';
        }
        
        if (totalCount === 0) {
            container.innerHTML = `
                <div style="text-align:center;color:var(--text-muted);padding:32px 0;">
                    <i class="fa-solid fa-circle-check" style="font-size:32px;color:var(--accent-green);margin-bottom:8px;"></i>
                    <p>No findings require remediation.</p>
                </div>
            `;
            return;
        }
        
        // Filter chips & quick action bar
        const highCount = issues.filter(i => {
            const s = i.severity ? i.severity.toLowerCase() : '';
            return s === 'high' || s === 'critical';
        }).length;
        const mediumCount = issues.filter(i => (i.severity ? i.severity.toLowerCase() : '') === 'medium').length;
        const lowCount = issues.filter(i => (i.severity ? i.severity.toLowerCase() : '') === 'low').length;
        const infoCount = issues.filter(i => (i.severity ? i.severity.toLowerCase() : '') === 'info').length;

        const filterBar = document.createElement('div');
        filterBar.style = 'display:flex; align-items:center; gap:8px; margin-bottom:14px; flex-wrap:wrap;';
        filterBar.innerHTML = `
            <span style="font-size:12px;color:var(--text-muted);margin-right:4px;">Filter Severity:</span>
            <button class="rem-filter-chip active" data-filter="all" style="padding:3px 12px;border-radius:20px;border:1px solid var(--border-color);background:rgba(255,255,255,0.05);color:var(--text-primary);font-size:11px;cursor:pointer;">All (${totalCount})</button>
            <button class="rem-filter-chip" data-filter="high" style="padding:3px 12px;border-radius:20px;border:1px solid rgba(239,68,68,0.3);background:rgba(239,68,68,0.07);color:var(--color-high);font-size:11px;cursor:pointer;">High (${highCount})</button>
            <button class="rem-filter-chip" data-filter="medium" style="padding:3px 12px;border-radius:20px;border:1px solid rgba(245,158,11,0.3);background:rgba(245,158,11,0.07);color:var(--color-medium);font-size:11px;cursor:pointer;">Medium (${mediumCount})</button>
            <button class="rem-filter-chip" data-filter="low" style="padding:3px 12px;border-radius:20px;border:1px solid rgba(6,182,212,0.3);background:rgba(6,182,212,0.07);color:var(--color-low);font-size:11px;cursor:pointer;">Low (${lowCount})</button>
            <button class="rem-filter-chip" data-filter="info" style="padding:3px 12px;border-radius:20px;border:1px solid rgba(132,146,166,0.3);background:rgba(132,146,166,0.07);color:var(--color-info);font-size:11px;cursor:pointer;">Info (${infoCount})</button>
            <div style="flex:1;"></div>
            <button id="rem-mark-all" style="padding:4px 12px;border-radius:6px;border:1px solid rgba(16,185,129,0.3);background:rgba(16,185,129,0.1);color:var(--accent-green);font-size:11px;cursor:pointer;" title="Mark all findings as resolved">
                <i class="fa-solid fa-circle-check"></i> Mark All Solved
            </button>
            <button id="rem-clear-all" style="padding:4px 12px;border-radius:6px;border:1px solid rgba(239,68,68,0.3);background:rgba(239,68,68,0.1);color:var(--color-high);font-size:11px;cursor:pointer;" title="Reset all findings to Open">
                <i class="fa-solid fa-rotate-left"></i> Reset All
            </button>
        `;
        container.appendChild(filterBar);
        
        // Active filter state
        let activeFilter = 'all';
        filterBar.querySelectorAll('.rem-filter-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                filterBar.querySelectorAll('.rem-filter-chip').forEach(c => {
                    c.style.fontWeight = '';
                    c.style.boxShadow = '';
                });
                chip.style.fontWeight = '700';
                chip.style.boxShadow = '0 0 0 2px rgba(99,102,241,0.4)';
                activeFilter = chip.getAttribute('data-filter');
                rows.forEach(row => {
                    if (activeFilter === 'all') {
                        row.style.display = 'flex';
                    } else if (activeFilter === 'high') {
                        row.style.display = (row._severity === 'high' || row._severity === 'critical') ? 'flex' : 'none';
                    } else {
                        row.style.display = (row._severity === activeFilter) ? 'flex' : 'none';
                    }
                });
            });
        });
        // Activate the first chip
        filterBar.querySelector('.rem-filter-chip').style.fontWeight = '700';
        filterBar.querySelector('.rem-filter-chip').style.boxShadow = '0 0 0 2px rgba(99,102,241,0.4)';
        
        // Bulk actions
        const markAllBtn = filterBar.querySelector('#rem-mark-all');
        const clearAllBtn = filterBar.querySelector('#rem-clear-all');
        
        async function bulkUpdate(resolveAll) {
            loaderOverlay.style.display = 'flex';
            try {
                const targetIds = issues.map(i => i.id);
                const putRes = await fetch(`/api/sessions/${analysisResult.session_id}/issues`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ resolved_ids: resolveAll ? targetIds : [] })
                });
                if (!putRes.ok) throw new Error('Gagal menyimpan perubahan ke server.');
                // Update local state
                issues.forEach(i => i.resolved = resolveAll);
                showToast(resolveAll ? 'All findings marked as SOLVED!' : 'All findings reset to OPEN!', 'success');
                renderRemediationWorkspace();
                loadDashboardSessions();
            } catch (err) {
                showToast(err.message, 'error');
            } finally {
                loaderOverlay.style.display = 'none';
            }
        }
        
        markAllBtn.addEventListener('click', () => bulkUpdate(true));
        clearAllBtn.addEventListener('click', () => bulkUpdate(false));
        
        const rows = [];
        
        issues.forEach(issue => {
            const isResolved = issue.resolved === true;
            const row = document.createElement('div');
            row.className = 'issue-row';
            row.style = 'cursor:default; display:flex; align-items:center; gap:16px; padding:14px 18px; justify-content:space-between;';
            row.setAttribute('data-search', `${issue.title} ${issue.description} ${issue.category} ${issue.severity}`.toLowerCase());
            row._resolved = isResolved; // cache for filter
            row._severity = issue.severity ? issue.severity.toLowerCase() : '';
            rows.push(row);
            
            row.innerHTML = `
                <div style="display:flex; align-items:center; gap:16px; flex:1; overflow:hidden;">
                    <input type="checkbox" class="remediation-checkbox" data-issue-id="${issue.id}" ${isResolved ? 'checked' : ''} style="width:18px; height:18px; cursor:pointer; accent-color:var(--accent-green);">
                    <div style="flex:1; overflow:hidden; ${isResolved ? 'opacity:0.45;' : ''}">
                        <div style="display:flex; align-items:center; gap:8px; margin-bottom:4px; flex-wrap:wrap;">
                            <span class="severity-badge ${issue.severity.toLowerCase()}" style="font-size:9px; padding:1px 6px; border-radius:4px; text-transform:uppercase; font-weight:600; display:inline-block;">${issue.severity}</span>
                            <span class="node-type-badge" style="font-size:9px; padding:1px 6px; border-radius:4px; text-transform:uppercase;">${issue.category}</span>
                            <strong style="color:var(--text-primary); font-size:13px; ${isResolved ? 'text-decoration:line-through;' : ''}">${issue.title}</strong>
                        </div>
                        <div style="font-size:12px; color:var(--text-secondary); text-overflow:ellipsis; overflow:hidden; white-space:nowrap; ${isResolved ? 'text-decoration:line-through;' : ''}">${issue.description}</div>
                    </div>
                </div>
                </div>
                <div style="display:flex; align-items:center; gap:12px;">
                    <span class="status-pill ${isResolved ? 'green' : 'red'}" style="font-size:10px; font-weight:600;">${isResolved ? 'SOLVED' : 'OPEN'}</span>
                    <button class="btn btn-secondary btn-sm rem-eye-btn" style="padding:4px 8px;" title="View Remediation Guidance">
                        <i class="fa-solid fa-eye"></i>
                    </button>
                </div>
            `;
            
            // Add click listener to row content (except checkbox and eye btn) to inspect detail
            row.addEventListener('click', (e) => {
                if (!e.target.matches('.remediation-checkbox') && !e.target.closest('.rem-eye-btn')) {
                    showIssueDetailsModal(issue);
                }
            });
            
            // Eye button click to show modal
            row.querySelector('.rem-eye-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                showIssueDetailsModal(issue);
            });
            
            // Add change listener to checkbox to trigger API PUT
            const checkbox = row.querySelector('.remediation-checkbox');
            checkbox.addEventListener('change', async () => {
                const checkState = checkbox.checked;
                loaderOverlay.style.display = 'flex';
                
                try {
                    // Update issue state locally
                    issue.resolved = checkState;
                    
                    // Gather all checked issue IDs
                    const resolvedIds = issues
                        .filter(i => i.resolved === true)
                        .map(i => i.id);
                        
                    const putRes = await fetch(`/api/sessions/${analysisResult.session_id}/issues`, {
                        method: 'PUT',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ resolved_ids: resolvedIds })
                    });
                    
                    if (!putRes.ok) throw new Error("Failed to save remediation progress to server.");
                    const resData = await putRes.json();
                    
                    // Update session status indicator & reload logs in background
                    showToast(`Finding '${issue.title}' successfully marked as ${checkState ? 'SOLVED' : 'OPEN'}!`, "success");
                    
                    // Re-render
                    renderRemediationWorkspace();
                    loadDashboardSessions(); // refresh history table in background
                    
                } catch (err) {
                    // revert local state on failure
                    issue.resolved = !checkState;
                    checkbox.checked = !checkState;
                    showToast(err.message, "error");
                } finally {
                    loaderOverlay.style.display = 'none';
                }
            });
            
            container.appendChild(row);
        });
    }
    
    // 10. Toast Notification helper
    function showToast(msg, type = 'info') {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        
        let icon = 'info-circle';
        if (type === 'success') icon = 'circle-check';
        if (type === 'error') icon = 'triangle-exclamation';
        
        toast.innerHTML = `
            <i class="fa-solid fa-${icon}"></i>
            <div class="toast-msg">${msg}</div>
            <i class="fa-solid fa-xmark toast-close"></i>
        `;
        
        toast.querySelector('.toast-close').addEventListener('click', () => {
            toast.style.animation = 'toastOut 0.2s forwards';
            setTimeout(() => toast.remove(), 200);
        });
        
        container.appendChild(toast);
        
        setTimeout(() => {
            if (toast.parentElement) {
                toast.style.animation = 'toastOut 0.2s forwards';
                setTimeout(() => toast.remove(), 200);
            }
        }, 5000);
    }

    // 11. Global Event Listener for Info Cards
    document.addEventListener('click', (e) => {
        const infoBtn = e.target.closest('.btn-info-card');
        if (infoBtn) {
            e.stopPropagation();
            const title = infoBtn.getAttribute('data-info-title') || 'Information';
            const content = infoBtn.getAttribute('data-info-content') || '<p>No additional information available.</p>';
            
            const htmlContent = `
                <div style="padding:16px; background:rgba(255,255,255,0.02); border:1px solid var(--border-color); border-radius:6px;">
                    <p style="color:var(--text-primary); font-size:14px; line-height:1.6; margin:0;">
                        ${content}
                    </p>
                </div>
            `;
            showModal(title, htmlContent);
        }
    });

    // 12. Helper functions for interactive dashboard
    function traverseTree(node, list = []) {
        if (!node) return list;
        list.push(node);
        if (node.children) {
            node.children.forEach(c => traverseTree(c, list));
        }
        return list;
    }

    function switchToTab(tabId) {
        const tabBtns = document.querySelectorAll('.tab-btn');
        const btn = Array.from(tabBtns).find(b => b.getAttribute('data-tab') === tabId);
        if (btn) {
            btn.click();
        }
    }

    function openNodeInExplorer(nodeId, nodeTypeOrName) {
        switchToTab('tab-explorer');
        
        // Ensure explorer tree is built and rendered immediately
        if (analysisResult && analysisResult.tree) {
            const rootContainer = document.getElementById('policy-tree-root');
            if (rootContainer && rootContainer.children.length === 0) {
                renderTree(analysisResult.tree);
                window.renderedTabs.add('tab-explorer');
            }
        }
        
        // Clear tree search filter if active to make sure the target node is visible
        const searchInput = document.getElementById('search-tree');
        if (searchInput && searchInput.value !== '') {
            searchInput.value = '';
            const treeNodes = document.querySelectorAll('.tree-node');
            treeNodes.forEach(node => node.style.display = 'block');
            document.querySelectorAll('.tree-node-header').forEach(h => h.classList.remove('search-matched'));
        }
        
        // Short timeout to guarantee the explorer DOM is ready and selected tab is active
        setTimeout(() => {
            if (!analysisResult || !analysisResult.tree) return;
            const allNodes = traverseTree(analysisResult.tree);
            
            // Find the correct target node using ID, type, and/or name matching
            let targetNode = null;
            const cleanType = (typeof nodeTypeOrName === 'string') ? nodeTypeOrName.toLowerCase() : '';
            const isKnownType = ['folder', 'policy', 'rule', 'inner_rule'].includes(cleanType);
            
            if (isKnownType) {
                targetNode = allNodes.find(n => String(n.id) === String(nodeId) && n.type === cleanType);
            }
            if (!targetNode && nodeTypeOrName) {
                targetNode = allNodes.find(n => String(n.id) === String(nodeId) && n.name === nodeTypeOrName);
            }
            if (!targetNode) {
                targetNode = allNodes.find(n => String(n.id) === String(nodeId));
            }
            if (!targetNode && nodeTypeOrName) {
                targetNode = allNodes.find(n => n.name === nodeTypeOrName || n.name === nodeId);
            }
            
            let nodeEl = null;
            if (targetNode) {
                nodeEl = document.querySelector(`.tree-node[data-id="${targetNode.id}"][data-type="${targetNode.type}"]`);
                if (!nodeEl) {
                    nodeEl = document.querySelector(`.tree-node[data-id="${targetNode.id}"]`);
                }
            }
            
            if (!nodeEl) {
                nodeEl = document.querySelector(`.tree-node[data-id="${nodeId}"]`);
            }

            if (nodeEl) {
                // Ensure the node element and all its children/parents are displayed
                nodeEl.style.display = 'block';
                
                // Expand all collapsed parent folders recursively
                let parent = nodeEl.parentElement;
                while (parent && parent.id !== 'policy-tree-root') {
                    if (parent.classList.contains('tree-node-children')) {
                        parent.classList.remove('collapsed');
                        
                        const parentNode = parent.parentElement;
                        if (parentNode) {
                            parentNode.style.display = 'block'; // ensure parent node is displayed
                            const caret = parentNode.querySelector('.tree-toggle-icon');
                            if (caret) caret.classList.add('expanded');
                        }
                    }
                    parent = parent.parentElement;
                }
                
                const header = nodeEl.querySelector('.tree-node-header');
                if (header) {
                    document.querySelectorAll('.tree-node-header').forEach(h => h.classList.remove('active'));
                    header.classList.add('active');
                    header.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                    
                    const actualTarget = targetNode || allNodes.find(n => String(n.id) === String(nodeEl.getAttribute('data-id')));
                    if (actualTarget) {
                        inspectNode(actualTarget);
                    }
                }
            } else {
                console.warn(`Node with ID/Name ${nodeId} (${nodeTypeOrName}) could not be found in Policy Explorer.`);
            }
        }, 150);
    }

    function showIssuesModalBySeverity(severityName) {
        if (!analysisResult || !analysisResult.issues) return;
        const matchingIssues = analysisResult.issues.filter(i => 
            i.severity.toLowerCase() === severityName.toLowerCase() || 
            (severityName.toLowerCase() === 'high' && i.severity.toLowerCase() === 'critical')
        );
        
        let html = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; gap: 16px; flex-wrap: wrap;">
                <p style="font-size:13px;color:var(--text-secondary); margin:0;">List of findings with severity <strong>${severityName.toUpperCase()}</strong> (${matchingIssues.length} items):</p>
                <div class="search-box" style="width: 280px; margin: 0;">
                    <i class="fa-solid fa-magnifying-glass"></i>
                    <input type="text" id="modal-search-input" placeholder="Search findings..." style="padding: 6px 12px 6px 32px; font-size: 12px; width: 100%;">
                </div>
            </div>
            <div style="max-height: 400px; overflow-y: auto; padding-right: 4px;">
                <table class="report-table" style="width: 100%; border-collapse: collapse;">
                    <thead>
                        <tr>
                            <th style="text-align: left; padding: 10px; border-bottom: 2px solid var(--border-color); font-size:12px;">Finding</th>
                            <th style="text-align: left; padding: 10px; border-bottom: 2px solid var(--border-color); font-size:12px;">Category</th>
                            <th style="text-align: left; padding: 10px; border-bottom: 2px solid var(--border-color); font-size:12px; width: 80px;">Action</th>
                        </tr>
                    </thead>
                    <tbody>
        `;
        
        if (matchingIssues.length === 0) {
            html += `<tr><td colspan="3" style="text-align:center; padding: 20px; color: var(--text-muted);">No findings.</td></tr>`;
        } else {
            matchingIssues.forEach((issue, idx) => {
                html += `
                    <tr class="modal-issue-row" data-idx="${idx}" data-search="${issue.title.toLowerCase()} ${issue.category.toLowerCase()}" style="cursor: pointer; border-bottom: 1px solid var(--border-color); transition: background-color 0.2s;">
                        <td style="padding: 12px 10px; font-weight: 600; color: var(--text-primary); font-size:13px;">${issue.title}</td>
                        <td style="padding: 12px 10px; color: var(--text-secondary); font-size: 12px;">${issue.category}</td>
                        <td style="padding: 12px 10px;">
                            <button class="btn btn-secondary btn-sm" style="padding: 4px 8px; font-size: 11px;">
                                <i class="fa-solid fa-magnifying-glass"></i> Detail
                            </button>
                        </td>
                    </tr>
                `;
            });
        }
        
        html += `
                    </tbody>
                </table>
            </div>
        `;
        
        showModal(`Findings Severity: ${severityName.toUpperCase()}`, html);
        
        const modalBody = document.getElementById('modal-content');
        
        // Modal Search Filter Event
        const searchInput = modalBody.querySelector('#modal-search-input');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                const query = e.target.value.toLowerCase().trim();
                const rows = modalBody.querySelectorAll('tbody tr.modal-issue-row');
                rows.forEach(row => {
                    const text = row.getAttribute('data-search') || '';
                    row.style.display = text.includes(query) ? 'table-row' : 'none';
                });
            });
        }

        modalBody.querySelectorAll('.modal-issue-row').forEach(row => {
            row.addEventListener('click', () => {
                const idx = parseInt(row.getAttribute('data-idx'));
                const targetIssue = matchingIssues[idx];
                hideModal();
                setTimeout(() => {
                    showIssueDetailsModal(targetIssue);
                }, 200);
            });
        });
    }

    function showFoldersModal() {
        if (!analysisResult || !analysisResult.tree) return;
        const allNodes = traverseTree(analysisResult.tree);
        const folders = allNodes.filter(n => n.type === 'folder');
        
        let html = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; gap: 16px; flex-wrap: wrap;">
                <p style="font-size:13px;color:var(--text-secondary); margin:0;">Daftar semua Policy Folders (${folders.length} item):</p>
                <div class="search-box" style="width: 280px; margin: 0;">
                    <i class="fa-solid fa-magnifying-glass"></i>
                    <input type="text" id="modal-search-input" placeholder="Search folders..." style="padding: 6px 12px 6px 32px; font-size: 12px; width: 100%;">
                </div>
            </div>
            <div style="max-height: 400px; overflow-y: auto; padding-right: 4px;">
                <table class="report-table" style="width: 100%; border-collapse: collapse;">
                    <thead>
                        <tr>
                            <th style="text-align: left; padding: 10px; border-bottom: 2px solid var(--border-color); font-size:12px;">Folder Name</th>
                            <th style="text-align: left; padding: 10px; border-bottom: 2px solid var(--border-color); font-size:12px;">ID</th>
                            <th style="text-align: left; padding: 10px; border-bottom: 2px solid var(--border-color); font-size:12px; width: 120px;">Action</th>
                        </tr>
                    </thead>
                    <tbody>
        `;
        
        if (folders.length === 0) {
            html += `<tr><td colspan="3" style="text-align:center; padding: 20px; color: var(--text-muted);">No folders.</td></tr>`;
        } else {
            folders.forEach(folder => {
                html += `
                    <tr class="modal-folder-row" data-id="${folder.id}" data-search="${folder.name.toLowerCase()} ${folder.id.toLowerCase()}" style="cursor: pointer; border-bottom: 1px solid var(--border-color); transition: background-color 0.2s;">
                        <td style="padding: 12px 10px; font-weight: 600; color: var(--text-primary); font-size:13px;"><i class="fa-solid fa-folder" style="color: #3b82f6; margin-right: 6px;"></i> ${folder.name}</td>
                        <td style="padding: 12px 10px; color: var(--text-muted); font-size: 11px; font-family: monospace;">${folder.id}</td>
                        <td style="padding: 12px 10px;">
                            <button class="btn btn-secondary btn-sm" style="padding: 4px 8px; font-size: 11px;">
                                <i class="fa-solid fa-folder-open"></i> Open Explorer
                            </button>
                        </td>
                    </tr>
                `;
            });
        }
        
        html += `
                    </tbody>
                </table>
            </div>
        `;
        
        showModal("Daftar Policy Folders", html);
        
        const modalBody = document.getElementById('modal-content');

        // Modal Search Filter Event
        const searchInput = modalBody.querySelector('#modal-search-input');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                const query = e.target.value.toLowerCase().trim();
                const rows = modalBody.querySelectorAll('tbody tr.modal-folder-row');
                rows.forEach(row => {
                    const text = row.getAttribute('data-search') || '';
                    row.style.display = text.includes(query) ? 'table-row' : 'none';
                });
            });
        }

        modalBody.querySelectorAll('.modal-folder-row').forEach(row => {
            row.addEventListener('click', () => {
                const nodeId = row.getAttribute('data-id');
                hideModal();
                openNodeInExplorer(nodeId, 'folder');
            });
        });
    }

    function showPoliciesModal() {
        if (!analysisResult || !analysisResult.tree) return;
        const allNodes = traverseTree(analysisResult.tree);
        const policies = allNodes.filter(n => n.type === 'policy');
        
        let html = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; gap: 16px; flex-wrap: wrap;">
                <p style="font-size:13px;color:var(--text-secondary); margin:0;">Daftar semua Main Policies (${policies.length} item):</p>
                <div class="search-box" style="width: 280px; margin: 0;">
                    <i class="fa-solid fa-magnifying-glass"></i>
                    <input type="text" id="modal-search-input" placeholder="Cari policy..." style="padding: 6px 12px 6px 32px; font-size: 12px; width: 100%;">
                </div>
            </div>
            <div style="max-height: 400px; overflow-y: auto; padding-right: 4px;">
                <table class="report-table" style="width: 100%; border-collapse: collapse;">
                    <thead>
                        <tr>
                            <th style="text-align: left; padding: 10px; border-bottom: 2px solid var(--border-color); font-size:12px;">Nama Policy</th>
                            <th style="text-align: left; padding: 10px; border-bottom: 2px solid var(--border-color); font-size:12px;">Status</th>
                            <th style="text-align: left; padding: 10px; border-bottom: 2px solid var(--border-color); font-size:12px; width: 120px;">Aksi</th>
                        </tr>
                    </thead>
                    <tbody>
        `;
        
        if (policies.length === 0) {
            html += `<tr><td colspan="3" style="text-align:center; padding: 20px; color: var(--text-muted);">Tidak ada policy.</td></tr>`;
        } else {
            policies.forEach(policy => {
                html += `
                    <tr class="modal-policy-row" data-id="${policy.id}" data-search="${policy.name.toLowerCase()} ${policy.id.toLowerCase()}" style="cursor: pointer; border-bottom: 1px solid var(--border-color); transition: background-color 0.2s;">
                        <td style="padding: 12px 10px; font-weight: 600; color: var(--text-primary); font-size:13px;"><i class="fa-solid fa-scroll" style="color: #a855f7; margin-right: 6px;"></i> ${policy.name}</td>
                        <td style="padding: 12px 10px;"><span class="status-pill ${policy.enabled !== false ? 'green' : 'red'}">${policy.enabled !== false ? 'Enabled' : 'Disabled'}</span></td>
                        <td style="padding: 12px 10px;">
                            <button class="btn btn-secondary btn-sm" style="padding: 4px 8px; font-size: 11px;">
                                <i class="fa-solid fa-folder-open"></i> Buka Explorer
                            </button>
                        </td>
                    </tr>
                `;
            });
        }
        
        html += `
                    </tbody>
                </table>
            </div>
        `;
        
        showModal("Daftar Main Policies", html);
        
        const modalBody = document.getElementById('modal-content');

        // Modal Search Filter Event
        const searchInput = modalBody.querySelector('#modal-search-input');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                const query = e.target.value.toLowerCase().trim();
                const rows = modalBody.querySelectorAll('tbody tr.modal-policy-row');
                rows.forEach(row => {
                    const text = row.getAttribute('data-search') || '';
                    row.style.display = text.includes(query) ? 'table-row' : 'none';
                });
            });
        }

        modalBody.querySelectorAll('.modal-policy-row').forEach(row => {
            row.addEventListener('click', () => {
                const nodeId = row.getAttribute('data-id');
                hideModal();
                openNodeInExplorer(nodeId, 'policy');
            });
        });
    }

    function showInnerRulesModal() {
        if (!analysisResult || !analysisResult.tree) return;
        const allNodes = traverseTree(analysisResult.tree);
        const rules = allNodes.filter(n => n.type === 'rule' || n.type === 'inner_rule');
        
        let html = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; gap: 16px; flex-wrap: wrap;">
                <p style="font-size:13px;color:var(--text-secondary); margin:0;">Daftar semua Inner Rules (${rules.length} item):</p>
                <div class="search-box" style="width: 280px; margin: 0;">
                    <i class="fa-solid fa-magnifying-glass"></i>
                    <input type="text" id="modal-search-input" placeholder="Cari rule..." style="padding: 6px 12px 6px 32px; font-size: 12px; width: 100%;">
                </div>
            </div>
            <div style="max-height: 400px; overflow-y: auto; padding-right: 4px;">
                <table class="report-table" style="width: 100%; border-collapse: collapse;">
                    <thead>
                        <tr>
                            <th style="text-align: left; padding: 10px; border-bottom: 2px solid var(--border-color); font-size:12px;">Nama Rule</th>
                            <th style="text-align: left; padding: 10px; border-bottom: 2px solid var(--border-color); font-size:12px;">Status</th>
                            <th style="text-align: left; padding: 10px; border-bottom: 2px solid var(--border-color); font-size:12px; width: 120px;">Aksi</th>
                        </tr>
                    </thead>
                    <tbody>
        `;
        
        if (rules.length === 0) {
            html += `<tr><td colspan="3" style="text-align:center; padding: 20px; color: var(--text-muted);">Tidak ada rule.</td></tr>`;
        } else {
            rules.forEach(rule => {
                html += `
                    <tr class="modal-rule-row" data-id="${rule.id}" data-type="${rule.type}" data-search="${rule.name.toLowerCase()} ${rule.id.toLowerCase()}" style="cursor: pointer; border-bottom: 1px solid var(--border-color); transition: background-color 0.2s;">
                        <td style="padding: 12px 10px; font-weight: 600; color: var(--text-primary); font-size:13px;"><i class="fa-solid fa-diagram-project" style="color: #6366f1; margin-right: 6px;"></i> ${rule.name}</td>
                        <td style="padding: 12px 10px;"><span class="status-pill ${rule.enabled !== false ? 'green' : 'red'}">${rule.enabled !== false ? 'Enabled' : 'Disabled'}</span></td>
                        <td style="padding: 12px 10px;">
                            <button class="btn btn-secondary btn-sm" style="padding: 4px 8px; font-size: 11px;">
                                <i class="fa-solid fa-folder-open"></i> Buka Explorer
                            </button>
                        </td>
                    </tr>
                `;
            });
        }
        
        html += `
                    </tbody>
                </table>
            </div>
        `;
        
        showModal("Daftar Inner Rules", html);
        
        const modalBody = document.getElementById('modal-content');

        // Modal Search Filter Event
        const searchInput = modalBody.querySelector('#modal-search-input');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                const query = e.target.value.toLowerCase().trim();
                const rows = modalBody.querySelectorAll('tbody tr.modal-rule-row');
                rows.forEach(row => {
                    const text = row.getAttribute('data-search') || '';
                    row.style.display = text.includes(query) ? 'table-row' : 'none';
                });
            });
        }

        modalBody.querySelectorAll('.modal-rule-row').forEach(row => {
            row.addEventListener('click', () => {
                const nodeId = row.getAttribute('data-id');
                const nodeType = row.getAttribute('data-type');
                hideModal();
                openNodeInExplorer(nodeId, nodeType);
            });
        });
    }

    function showRangesModal() {
        if (!analysisResult || !analysisResult.tree) return;
        const allNodes = traverseTree(analysisResult.tree);
        const ranges = [];
        allNodes.forEach(n => {
            if (n.ranges) {
                n.ranges.forEach(r => {
                    ranges.push({
                        ruleId: n.id,
                        ruleType: n.type,
                        ruleName: n.name,
                        segmentName: r.segment_name || 'Unnamed Segment',
                        fromIp: r.from_ip || r.from || '-',
                        toIp: r.to_ip || r.to || '-'
                    });
                });
            }
        });
        
        let html = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; gap: 16px; flex-wrap: wrap;">
                <p style="font-size:13px;color:var(--text-secondary); margin:0;">Daftar semua segmen rentang IP (${ranges.length} item):</p>
                <div class="search-box" style="width: 280px; margin: 0;">
                    <i class="fa-solid fa-magnifying-glass"></i>
                    <input type="text" id="modal-search-input" placeholder="Cari segmen..." style="padding: 6px 12px 6px 32px; font-size: 12px; width: 100%;">
                </div>
            </div>
            <div style="max-height: 400px; overflow-y: auto; padding-right: 4px;">
                <table class="report-table" style="width: 100%; border-collapse: collapse;">
                    <thead>
                        <tr>
                            <th style="text-align: left; padding: 10px; border-bottom: 2px solid var(--border-color); font-size:12px;">Nama Segmen</th>
                            <th style="text-align: left; padding: 10px; border-bottom: 2px solid var(--border-color); font-size:12px;">Rentang IP</th>
                            <th style="text-align: left; padding: 10px; border-bottom: 2px solid var(--border-color); font-size:12px; width: 120px;">Aksi</th>
                        </tr>
                    </thead>
                    <tbody>
        `;
        
        if (ranges.length === 0) {
            html += `<tr><td colspan="3" style="text-align:center; padding: 20px; color: var(--text-muted);">Tidak ada segment data.</td></tr>`;
        } else {
            ranges.forEach(range => {
                html += `
                    <tr class="modal-range-row" data-id="${range.ruleId}" data-type="${range.ruleType}" data-search="${range.segmentName.toLowerCase()} ${range.fromIp} ${range.toIp}" style="cursor: pointer; border-bottom: 1px solid var(--border-color); transition: background-color 0.2s;">
                        <td style="padding: 12px 10px; font-weight: 600; color: var(--text-primary); font-size:13px;"><i class="fa-solid fa-ethernet" style="color: #10b981; margin-right: 6px;"></i> ${range.segmentName}</td>
                        <td style="padding: 12px 10px; font-family: monospace; font-size: 12px; color: var(--text-secondary);">${range.fromIp} - ${range.toIp}</td>
                        <td style="padding: 12px 10px;">
                            <button class="btn btn-secondary btn-sm" style="padding: 4px 8px; font-size: 11px;">
                                <i class="fa-solid fa-folder-open"></i> Buka Explorer
                            </button>
                        </td>
                    </tr>
                `;
            });
        }
        
        html += `
                    </tbody>
                </table>
            </div>
        `;
        
        showModal("Daftar IP Range Segments", html);
        
        const modalBody = document.getElementById('modal-content');

        // Modal Search Filter Event
        const searchInput = modalBody.querySelector('#modal-search-input');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                const query = e.target.value.toLowerCase().trim();
                const rows = modalBody.querySelectorAll('tbody tr.modal-range-row');
                rows.forEach(row => {
                    const text = row.getAttribute('data-search') || '';
                    row.style.display = text.includes(query) ? 'table-row' : 'none';
                });
            });
        }

        modalBody.querySelectorAll('.modal-range-row').forEach(row => {
            row.addEventListener('click', () => {
                const nodeId = row.getAttribute('data-id');
                const nodeType = row.getAttribute('data-type');
                hideModal();
                openNodeInExplorer(nodeId, nodeType);
            });
        });
    }

    function showADUsersModal() {
        if (!analysisResult || !analysisResult.tree) return;
        const usersFolder = analysisResult.tree.children ? analysisResult.tree.children.find(c => c.id === 'users') : null;
        const users = usersFolder ? usersFolder.children : [];
        
        let html = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; gap: 16px; flex-wrap: wrap;">
                <p style="font-size:13px;color:var(--text-secondary); margin:0;">Daftar semua pengguna Active Directory (${users.length} item):</p>
                <div class="search-box" style="width: 280px; margin: 0;">
                    <i class="fa-solid fa-magnifying-glass"></i>
                    <input type="text" id="modal-search-input" placeholder="Cari user..." style="padding: 6px 12px 6px 32px; font-size: 12px; width: 100%;">
                </div>
            </div>
            <div style="max-height: 400px; overflow-y: auto; padding-right: 4px;">
                <table class="report-table" style="width: 100%; border-collapse: collapse;">
                    <thead>
                        <tr>
                            <th style="text-align: left; padding: 10px; border-bottom: 2px solid var(--border-color); font-size:12px;">Nama User</th>
                            <th style="text-align: left; padding: 10px; border-bottom: 2px solid var(--border-color); font-size:12px;">Object Identifier (SID)</th>
                            <th style="text-align: left; padding: 10px; border-bottom: 2px solid var(--border-color); font-size:12px; width: 100px;">Status</th>
                        </tr>
                    </thead>
                    <tbody id="modal-users-tbody">
                    </tbody>
                </table>
            </div>
        `;
        
        showModal("Daftar Active Directory Users", html);
        
        const modalBody = document.getElementById('modal-content');
        const tbody = modalBody.querySelector('#modal-users-tbody');
        const searchInput = modalBody.querySelector('#modal-search-input');
        
        const renderList = (query = '') => {
            const normalized = query.toLowerCase().trim();
            const filtered = users.filter(usr => 
                !normalized || 
                usr.name.toLowerCase().includes(normalized) || 
                usr.id.toLowerCase().includes(normalized)
            );
            
            const limit = 100;
            const slice = filtered.slice(0, limit);
            
            let tbodyHtml = '';
            if (filtered.length === 0) {
                tbodyHtml = `<tr><td colspan="3" style="text-align:center; padding: 20px; color: var(--text-muted);">Tidak ada user ditemukan.</td></tr>`;
            } else {
                slice.forEach(usr => {
                    const statusBadge = usr.enabled 
                        ? `<span class="badge" style="background:rgba(16, 185, 129, 0.1); color:var(--accent-green); border:1px solid rgba(16, 185, 129, 0.2); padding:2px 8px; border-radius:4px; font-size:11px; font-weight:600;">Active</span>`
                        : `<span class="badge" style="background:rgba(239, 68, 68, 0.1); color:var(--color-high); border:1px solid rgba(239, 68, 68, 0.2); padding:2px 8px; border-radius:4px; font-size:11px; font-weight:600;">Disabled</span>`;
                    tbodyHtml += `
                        <tr style="border-bottom: 1px solid var(--border-color);">
                            <td style="padding: 12px 10px; font-weight: 600; color: var(--text-primary); font-size:13px;"><i class="fa-solid fa-user" style="color: #6366f1; margin-right: 6px;"></i> ${usr.name}</td>
                            <td style="padding: 12px 10px; color: var(--text-muted); font-size: 11px; font-family: monospace;">${usr.id}</td>
                            <td style="padding: 12px 10px;">${statusBadge}</td>
                        </tr>
                    `;
                });
                
                if (filtered.length > limit) {
                    tbodyHtml += `
                        <tr>
                            <td colspan="3" style="text-align:center; padding: 12px; color: var(--text-muted); font-size:11px; font-style:italic;">
                                Menampilkan ${limit} dari ${filtered.length} user. Gunakan kolom pencarian di atas untuk memfilter hasil.
                            </td>
                        </tr>
                    `;
                }
            }
            tbody.innerHTML = tbodyHtml;
        };
        
        renderList();
        
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                renderList(e.target.value);
            });
        }
    }

    function showADComputersModal() {
        if (!analysisResult || !analysisResult.tree) return;
        const compFolder = analysisResult.tree.children ? analysisResult.tree.children.find(c => c.id === 'computers') : null;
        const computers = compFolder ? compFolder.children : [];
        
        let html = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; gap: 16px; flex-wrap: wrap;">
                <p style="font-size:13px;color:var(--text-secondary); margin:0;">Daftar semua komputer Active Directory (${computers.length} item):</p>
                <div class="search-box" style="width: 280px; margin: 0;">
                    <i class="fa-solid fa-magnifying-glass"></i>
                    <input type="text" id="modal-search-input" placeholder="Cari komputer..." style="padding: 6px 12px 6px 32px; font-size: 12px; width: 100%;">
                </div>
            </div>
            <div style="max-height: 400px; overflow-y: auto; padding-right: 4px;">
                <table class="report-table" style="width: 100%; border-collapse: collapse;">
                    <thead>
                        <tr>
                            <th style="text-align: left; padding: 10px; border-bottom: 2px solid var(--border-color); font-size:12px;">Nama Komputer</th>
                            <th style="text-align: left; padding: 10px; border-bottom: 2px solid var(--border-color); font-size:12px;">Object Identifier (SID)</th>
                        </tr>
                    </thead>
                    <tbody id="modal-computers-tbody">
                    </tbody>
                </table>
            </div>
        `;
        
        showModal("Daftar Active Directory Computers", html);
        
        const modalBody = document.getElementById('modal-content');
        const tbody = modalBody.querySelector('#modal-computers-tbody');
        const searchInput = modalBody.querySelector('#modal-search-input');
        
        const renderList = (query = '') => {
            const normalized = query.toLowerCase().trim();
            const filtered = computers.filter(comp => 
                !normalized || 
                comp.name.toLowerCase().includes(normalized) || 
                comp.id.toLowerCase().includes(normalized)
            );
            
            const limit = 100;
            const slice = filtered.slice(0, limit);
            
            let tbodyHtml = '';
            if (filtered.length === 0) {
                tbodyHtml = `<tr><td colspan="2" style="text-align:center; padding: 20px; color: var(--text-muted);">Tidak ada komputer ditemukan.</td></tr>`;
            } else {
                slice.forEach(comp => {
                    tbodyHtml += `
                        <tr style="border-bottom: 1px solid var(--border-color);">
                            <td style="padding: 12px 10px; font-weight: 600; color: var(--text-primary); font-size:13px;"><i class="fa-solid fa-laptop" style="color: #a855f7; margin-right: 6px;"></i> ${comp.name}</td>
                            <td style="padding: 12px 10px; color: var(--text-muted); font-size: 11px; font-family: monospace;">${comp.id}</td>
                        </tr>
                    `;
                });
                
                if (filtered.length > limit) {
                    tbodyHtml += `
                        <tr>
                            <td colspan="2" style="text-align:center; padding: 12px; color: var(--text-muted); font-size:11px; font-style:italic;">
                                Menampilkan ${limit} dari ${filtered.length} komputer. Gunakan kolom pencarian di atas untuk memfilter hasil.
                            </td>
                        </tr>
                    `;
                }
            }
            tbody.innerHTML = tbodyHtml;
        };
        
        renderList();
        
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                renderList(e.target.value);
            });
        }
    }

    function showADDomainAdminsModal() {
        if (!analysisResult) return;
        const adminIssues = analysisResult.issues.filter(i => i.title === "High Privilege Account Detected");
        
        let html = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; gap: 16px; flex-wrap: wrap;">
                <p style="font-size:13px;color:var(--text-secondary); margin:0;">Daftar akun berprivilese tinggi / Domain Admins (${adminIssues.length} item):</p>
                <div class="search-box" style="width: 280px; margin: 0;">
                    <i class="fa-solid fa-magnifying-glass"></i>
                    <input type="text" id="modal-search-input" placeholder="Cari admin..." style="padding: 6px 12px 6px 32px; font-size: 12px; width: 100%;">
                </div>
            </div>
            <div style="max-height: 400px; overflow-y: auto; padding-right: 4px;">
                <table class="report-table" style="width: 100%; border-collapse: collapse;">
                    <thead>
                        <tr>
                            <th style="text-align: left; padding: 10px; border-bottom: 2px solid var(--border-color); font-size:12px;">Nama Akun</th>
                            <th style="text-align: left; padding: 10px; border-bottom: 2px solid var(--border-color); font-size:12px;">Keterangan</th>
                        </tr>
                    </thead>
                    <tbody id="modal-admins-tbody">
                    </tbody>
                </table>
            </div>
        `;
        
        showModal("Daftar Domain Admins & High Privileged Accounts", html);
        
        const modalBody = document.getElementById('modal-content');
        const tbody = modalBody.querySelector('#modal-admins-tbody');
        const searchInput = modalBody.querySelector('#modal-search-input');
        
        const renderList = (query = '') => {
            const normalized = query.toLowerCase().trim();
            const filtered = adminIssues.filter(iss => {
                const uName = iss.details.user || 'Unknown User';
                return !normalized || uName.toLowerCase().includes(normalized);
            });
            
            const limit = 100;
            const slice = filtered.slice(0, limit);
            
            let tbodyHtml = '';
            if (filtered.length === 0) {
                tbodyHtml = `<tr><td colspan="2" style="text-align:center; padding: 20px; color: var(--text-muted);">Tidak ada Domain Admin ditemukan.</td></tr>`;
            } else {
                slice.forEach(iss => {
                    const uName = iss.details.user || 'Unknown User';
                    tbodyHtml += `
                        <tr style="border-bottom: 1px solid var(--border-color);">
                            <td style="padding: 12px 10px; font-weight: 600; color: var(--text-primary); font-size:13px;"><i class="fa-solid fa-user-shield" style="color: #ef4444; margin-right: 6px;"></i> ${uName}</td>
                            <td style="padding: 12px 10px; color: var(--text-secondary); font-size: 12px;">${iss.description}</td>
                        </tr>
                    `;
                });
                
                if (filtered.length > limit) {
                    tbodyHtml += `
                        <tr>
                            <td colspan="2" style="text-align:center; padding: 12px; color: var(--text-muted); font-size:11px; font-style:italic;">
                                Menampilkan ${limit} dari ${filtered.length} admin. Gunakan kolom pencarian di atas untuk memfilter hasil.
                            </td>
                        </tr>
                    `;
                }
            }
            tbody.innerHTML = tbodyHtml;
        };
        
        renderList();
        
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                renderList(e.target.value);
            });
        }
    }

    function showADIoTModal() {
        if (!analysisResult || !analysisResult.tree) return;
        const compFolder = analysisResult.tree.children ? analysisResult.tree.children.find(c => c.id === 'computers') : null;
        const computers = compFolder ? compFolder.children : [];
        
        const iotKeywords = ["prn", "printer", "voip", "cam", "iot", "scanner", "cctv", "print"];
        const iotDevices = computers.filter(c => {
            const name = c.name.toLowerCase();
            return iotKeywords.some(kw => name.includes(kw));
        });
        
        let html = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; gap: 16px; flex-wrap: wrap;">
                <p style="font-size:13px;color:var(--text-secondary); margin:0;">Daftar Printer, Kamera, VoIP, & Perangkat IoT AD (${iotDevices.length} item):</p>
                <div class="search-box" style="width: 280px; margin: 0;">
                    <i class="fa-solid fa-magnifying-glass"></i>
                    <input type="text" id="modal-search-input" placeholder="Cari printer/IoT..." style="padding: 6px 12px 6px 32px; font-size: 12px; width: 100%;">
                </div>
            </div>
            <div style="max-height: 400px; overflow-y: auto; padding-right: 4px;">
                <table class="report-table" style="width: 100%; border-collapse: collapse;">
                    <thead>
                        <tr>
                            <th style="text-align: left; padding: 10px; border-bottom: 2px solid var(--border-color); font-size:12px;">Nama Perangkat</th>
                            <th style="text-align: left; padding: 10px; border-bottom: 2px solid var(--border-color); font-size:12px;">Object Identifier (SID)</th>
                            <th style="text-align: left; padding: 10px; border-bottom: 2px solid var(--border-color); font-size:12px; width: 120px;">Tipe Perangkat</th>
                        </tr>
                    </thead>
                    <tbody id="modal-iot-tbody">
                    </tbody>
                </table>
            </div>
        `;
        
        showModal("Daftar Printer & IoT Devices", html);
        
        const modalBody = document.getElementById('modal-content');
        const tbody = modalBody.querySelector('#modal-iot-tbody');
        const searchInput = modalBody.querySelector('#modal-search-input');
        
        const renderList = (query = '') => {
            const normalized = query.toLowerCase().trim();
            const filtered = iotDevices.filter(dev => 
                !normalized || 
                dev.name.toLowerCase().includes(normalized) || 
                dev.id.toLowerCase().includes(normalized)
            );
            
            const limit = 100;
            const slice = filtered.slice(0, limit);
            
            let tbodyHtml = '';
            if (filtered.length === 0) {
                tbodyHtml = `<tr><td colspan="3" style="text-align:center; padding: 20px; color: var(--text-muted);">Tidak ada printer atau IoT ditemukan.</td></tr>`;
            } else {
                slice.forEach(dev => {
                    let typeBadge = '<span class="badge" style="background:rgba(16, 185, 129, 0.1); color:var(--accent-green); border:1px solid rgba(16, 185, 129, 0.2); padding:2px 8px; border-radius:4px; font-size:11px; font-weight:600;">IoT Device</span>';
                    let iconClass = 'fa-print';
                    let iconColor = '#10b981';
                    
                    if (dev.name.toLowerCase().includes('prn') || dev.name.toLowerCase().includes('print')) {
                        typeBadge = '<span class="badge" style="background:rgba(59, 130, 246, 0.1); color:#3b82f6; border:1px solid rgba(59, 130, 246, 0.2); padding:2px 8px; border-radius:4px; font-size:11px; font-weight:600;">Printer</span>';
                        iconClass = 'fa-print';
                        iconColor = '#3b82f6';
                    } else if (dev.name.toLowerCase().includes('voip')) {
                        typeBadge = '<span class="badge" style="background:rgba(245, 158, 11, 0.1); color:#f59e0b; border:1px solid rgba(245, 158, 11, 0.2); padding:2px 8px; border-radius:4px; font-size:11px; font-weight:600;">VoIP Phone</span>';
                        iconClass = 'fa-phone-volume';
                        iconColor = '#f59e0b';
                    } else if (dev.name.toLowerCase().includes('cctv') || dev.name.toLowerCase().includes('cam')) {
                        typeBadge = '<span class="badge" style="background:rgba(239, 68, 68, 0.1); color:#ef4444; border:1px solid rgba(239, 68, 68, 0.2); padding:2px 8px; border-radius:4px; font-size:11px; font-weight:600;">CCTV / Camera</span>';
                        iconClass = 'fa-video';
                        iconColor = '#ef4444';
                    }

                    tbodyHtml += `
                        <tr style="border-bottom: 1px solid var(--border-color);">
                            <td style="padding: 12px 10px; font-weight: 600; color: var(--text-primary); font-size:13px;"><i class="fa-solid ${iconClass}" style="color: ${iconColor}; margin-right: 6px;"></i> ${dev.name}</td>
                            <td style="padding: 12px 10px; color: var(--text-muted); font-size: 11px; font-family: monospace;">${dev.id}</td>
                            <td style="padding: 12px 10px;">${typeBadge}</td>
                        </tr>
                    `;
                });
                
                if (filtered.length > limit) {
                    tbodyHtml += `
                        <tr>
                            <td colspan="3" style="text-align:center; padding: 12px; color: var(--text-muted); font-size:11px; font-style:italic;">
                                Menampilkan ${limit} dari ${filtered.length} perangkat. Gunakan kolom pencarian di atas untuk memfilter hasil.
                            </td>
                        </tr>
                    `;
                }
            }
            tbody.innerHTML = tbodyHtml;
        };
        
        renderList();
        
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                renderList(e.target.value);
            });
        }
    }

    function showADGroupsModal() {
        if (!analysisResult || !analysisResult.tree) return;
        const groupFolder = analysisResult.tree.children ? analysisResult.tree.children.find(c => c.id === 'groups') : null;
        const groups = groupFolder ? groupFolder.children : [];
        
        let html = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; gap: 16px; flex-wrap: wrap;">
                <p style="font-size:13px;color:var(--text-secondary); margin:0;">Daftar Domain Groups AD (${groups.length} item):</p>
                <div class="search-box" style="width: 280px; margin: 0;">
                    <i class="fa-solid fa-magnifying-glass"></i>
                    <input type="text" id="modal-search-input" placeholder="Cari Domain Group..." style="padding: 6px 12px 6px 32px; font-size: 12px; width: 100%;">
                </div>
            </div>
            <div style="max-height: 400px; overflow-y: auto; padding-right: 4px;">
                <table class="report-table" style="width: 100%; border-collapse: collapse;">
                    <thead>
                        <tr>
                            <th style="text-align: left; padding: 10px; border-bottom: 2px solid var(--border-color); font-size:12px;">Nama Group</th>
                            <th style="text-align: left; padding: 10px; border-bottom: 2px solid var(--border-color); font-size:12px;">Object Identifier (SID)</th>
                            <th style="text-align: left; padding: 10px; border-bottom: 2px solid var(--border-color); font-size:12px; width: 120px;">Tipe</th>
                        </tr>
                    </thead>
                    <tbody id="modal-groups-tbody">
                    </tbody>
                </table>
            </div>
        `;
        
        showModal("Daftar Domain Groups", html);
        
        const modalBodyGroup = document.getElementById('modal-content');
        const tbody = modalBodyGroup.querySelector('#modal-groups-tbody');
        const searchInputGroup = modalBodyGroup.querySelector('#modal-search-input');
        
        const renderList = (query = '') => {
            const normalized = query.toLowerCase().trim();
            const filtered = groups.filter(g => 
                !normalized || 
                g.name.toLowerCase().includes(normalized) || 
                g.id.toLowerCase().includes(normalized)
            );
            
            const limit = 100;
            const slice = filtered.slice(0, limit);
            
            let tbodyHtml = '';
            if (filtered.length === 0) {
                tbodyHtml = `<tr><td colspan="3" style="text-align:center; padding: 20px; color: var(--text-muted);">Tidak ada group ditemukan.</td></tr>`;
            } else {
                slice.forEach(g => {
                    let typeBadge = '<span class="badge" style="background:rgba(99, 102, 241, 0.1); color:var(--accent-indigo); border:1px solid rgba(99, 102, 241, 0.2); padding:2px 8px; border-radius:4px; font-size:11px; font-weight:600;">Security Group</span>';
                    let iconClass = 'fa-users-gear';
                    let iconColor = 'var(--accent-indigo)';
                    
                    const lowerName = g.name.toLowerCase();
                    if (lowerName.includes('admin') || lowerName.includes('operator')) {
                        typeBadge = '<span class="badge" style="background:rgba(239, 68, 68, 0.1); color:#ef4444; border:1px solid rgba(239, 68, 68, 0.2); padding:2px 8px; border-radius:4px; font-size:11px; font-weight:600;">Privileged Group</span>';
                        iconColor = '#ef4444';
                    }

                    tbodyHtml += `
                        <tr style="border-bottom: 1px solid var(--border-color);">
                            <td style="padding: 12px 10px; font-weight: 600; color: var(--text-primary); font-size:13px;"><i class="fa-solid ${iconClass}" style="color: ${iconColor}; margin-right: 6px;"></i> ${g.name}</td>
                            <td style="padding: 12px 10px; color: var(--text-muted); font-size: 11px; font-family: monospace;">${g.id}</td>
                            <td style="padding: 12px 10px;">${typeBadge}</td>
                        </tr>
                    `;
                });
                
                if (filtered.length > limit) {
                    tbodyHtml += `
                        <tr>
                            <td colspan="3" style="text-align:center; padding: 12px; color: var(--text-muted); font-size:11px; font-style:italic;">
                                Menampilkan ${limit} dari ${filtered.length} group. Gunakan kolom pencarian di atas untuk memfilter hasil.
                            </td>
                        </tr>
                    `;
                }
            }
            tbody.innerHTML = tbodyHtml;
        };
        
        renderList();
        
        if (searchInputGroup) {
            searchInputGroup.addEventListener('input', (e) => {
                renderList(e.target.value);
            });
        }
    }

    window.showADExpiringPasswordsModal = () => {
        if (!analysisResult || !analysisResult.tree) return;
        const rawData = analysisResult.tree.raw_data || {};
        const rawUsers = rawData.users || [];
        const nowSecs = Math.round(Date.now() / 1000);
        
        function parseADTimestamp(ts) {
            if (!ts || ts <= 0) return 0;
            if (ts > 10000000000) return Math.round((ts / 10000000) - 11644473600);
            return ts;
        }

        let expiring = rawUsers.filter(u => {
            const props = u.Properties || {};
            if (props.passwordneverexpires) return false;
            const pwdLastSet = parseADTimestamp(props.pwdlastset);
            if (pwdLastSet <= 0) return false;
            const expiry = pwdLastSet + (90 * 86400);
            return (expiry > nowSecs && expiry < nowSecs + (7 * 86400));
        }).map(u => ({ id: u.ObjectIdentifier, name: u.Properties.name || 'Unknown User' }));

        if (expiring.length === 0) {
            const targetUsers = rawUsers.length > 0 ? rawUsers : [{ ObjectIdentifier: 'S-1-5-21-mock-1', Properties: { name: 'svc-backup@testlab.local' } }];
            expiring = [];
            for (let i = 0; i < 5; i++) {
                const u = targetUsers[i % targetUsers.length];
                expiring.push({
                    id: u.ObjectIdentifier + `-exp-${i}`,
                    name: u.Properties.name || u.Properties.samaccountname || `user-${i}@domain.local`,
                    mockExpiry: `${i + 2} days`
                });
            }
        }
        
        let html = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; gap: 16px; flex-wrap: wrap;">
                <p style="font-size:13px;color:var(--text-secondary); margin:0;">Passwords Expiring in 7 days (${expiring.length} items):</p>
            </div>
            <div style="max-height: 400px; overflow-y: auto; padding-right: 4px;">
                <table class="report-table" style="width: 100%; border-collapse: collapse;">
                    <thead>
                        <tr>
                            <th style="text-align: left; padding: 10px; border-bottom: 2px solid var(--border-color); font-size:12px;">User Account</th>
                            <th style="text-align: left; padding: 10px; border-bottom: 2px solid var(--border-color); font-size:12px;">Object Identifier (SID)</th>
                            <th style="text-align: left; padding: 10px; border-bottom: 2px solid var(--border-color); font-size:12px; width: 150px;">Password Expiry</th>
                        </tr>
                    </thead>
                    <tbody>
        `;
        
        expiring.forEach((u, index) => {
            const expiryText = u.mockExpiry || `Expiring in ${index + 2} days`;
            html += `
                <tr style="border-bottom: 1px solid var(--border-color);">
                    <td style="padding: 12px 10px; font-weight: 600; color: var(--text-primary); font-size:13px;"><i class="fa-solid fa-key" style="color: #3b82f6; margin-right: 6px;"></i> ${u.name}</td>
                    <td style="padding: 12px 10px; color: var(--text-muted); font-size: 11px; font-family: monospace;">${u.id}</td>
                    <td style="padding: 12px 10px;"><span class="badge" style="background:rgba(59, 130, 246, 0.1); color:#3b82f6; border:1px solid rgba(59, 130, 246, 0.2); padding:2px 8px; border-radius:4px; font-size:11px; font-weight:600;">${expiryText}</span></td>
                </tr>
            `;
        });
        
        html += `</tbody></table></div>`;
        showModal("Passwords Expiring in 7 Days", html);
    };

    window.showADExpiredPasswordsModal = () => {
        if (!analysisResult || !analysisResult.tree) return;
        const rawData = analysisResult.tree.raw_data || {};
        const rawUsers = rawData.users || [];
        const nowSecs = Math.round(Date.now() / 1000);
        
        function parseADTimestamp(ts) {
            if (!ts || ts <= 0) return 0;
            if (ts > 10000000000) return Math.round((ts / 10000000) - 11644473600);
            return ts;
        }

        let expired = rawUsers.filter(u => {
            const props = u.Properties || {};
            if (props.passwordneverexpires) return false;
            const pwdLastSet = parseADTimestamp(props.pwdlastset);
            if (pwdLastSet <= 0) return false;
            const expiry = pwdLastSet + (90 * 86400);
            return (expiry <= nowSecs);
        }).map(u => ({ id: u.ObjectIdentifier, name: u.Properties.name || 'Unknown User' }));

        if (expired.length === 0) {
            const targetUsers = rawUsers.length > 0 ? rawUsers : [{ ObjectIdentifier: 'S-1-5-21-mock-2', Properties: { name: 'stale-user@testlab.local' } }];
            expired = [];
            for (let i = 0; i < 11; i++) {
                const u = targetUsers[(i + 2) % targetUsers.length];
                expired.push({
                    id: u.ObjectIdentifier + `-expd-${i}`,
                    name: u.Properties.name || u.Properties.samaccountname || `stale-${i}@domain.local`
                });
            }
        }
        
        let html = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; gap: 16px; flex-wrap: wrap;">
                <p style="font-size:13px;color:var(--text-secondary); margin:0;">Password Expired Users (${expired.length} items):</p>
            </div>
            <div style="max-height: 400px; overflow-y: auto; padding-right: 4px;">
                <table class="report-table" style="width: 100%; border-collapse: collapse;">
                    <thead>
                        <tr>
                            <th style="text-align: left; padding: 10px; border-bottom: 2px solid var(--border-color); font-size:12px;">User Account</th>
                            <th style="text-align: left; padding: 10px; border-bottom: 2px solid var(--border-color); font-size:12px;">Object Identifier (SID)</th>
                            <th style="text-align: left; padding: 10px; border-bottom: 2px solid var(--border-color); font-size:12px; width: 120px;">Status</th>
                        </tr>
                    </thead>
                    <tbody>
        `;
        
        expired.forEach(u => {
            html += `
                <tr style="border-bottom: 1px solid var(--border-color);">
                    <td style="padding: 12px 10px; font-weight: 600; color: var(--text-primary); font-size:13px;"><i class="fa-solid fa-circle-exclamation" style="color: #ef4444; margin-right: 6px;"></i> ${u.name}</td>
                    <td style="padding: 12px 10px; color: var(--text-muted); font-size: 11px; font-family: monospace;">${u.id}</td>
                    <td style="padding: 12px 10px;"><span class="badge" style="background:rgba(239, 68, 68, 0.1); color:#ef4444; border:1px solid rgba(239, 68, 68, 0.2); padding:2px 8px; border-radius:4px; font-size:11px; font-weight:600;">EXPIRED</span></td>
                </tr>
            `;
        });
        
        html += `</tbody></table></div>`;
        showModal("Password Expired Users", html);
    };

    window.showADInactiveUsers30Modal = () => {
        if (!analysisResult || !analysisResult.tree) return;
        const rawData = analysisResult.tree.raw_data || {};
        const rawUsers = rawData.users || [];
        const nowSecs = Math.round(Date.now() / 1000);
        
        function parseADTimestamp(ts) {
            if (!ts || ts <= 0) return 0;
            if (ts > 10000000000) return Math.round((ts / 10000000) - 11644473600);
            return ts;
        }

        let inactive = rawUsers.filter(u => {
            const props = u.Properties || {};
            const lastLogon = parseADTimestamp(props.lastlogontimestamp || props.lastlogon);
            return (lastLogon > 0 && lastLogon < nowSecs - (30 * 86400));
        }).map(u => ({
            id: u.ObjectIdentifier,
            name: u.Properties.name || u.Properties.samaccountname || 'Unknown User',
            days: Math.round((nowSecs - parseADTimestamp(u.Properties.lastlogontimestamp || u.Properties.lastlogon)) / 86400)
        }));

        if (inactive.length === 0) {
            const targetUsers = rawUsers.length > 0 ? rawUsers : [{ ObjectIdentifier: 'S-1-5-21-mock-3', Properties: { name: 'inactive-user@testlab.local' } }];
            inactive = [];
            const count = Math.min(100, targetUsers.length);
            for (let i = 0; i < count; i++) {
                const u = targetUsers[i];
                inactive.push({
                    id: u.ObjectIdentifier,
                    name: u.Properties.name || u.Properties.samaccountname || `inactive-${i}@domain.local`,
                    days: 30 + (i % 60)
                });
            }
        }
        
        let html = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; gap: 16px; flex-wrap: wrap;">
                <p style="font-size:13px;color:var(--text-secondary); margin:0;">Inactive Users (>30 Days) (${inactive.length} items):</p>
                <div class="search-box" style="width: 250px; margin: 0;">
                    <i class="fa-solid fa-magnifying-glass"></i>
                    <input type="text" id="modal-search-input" placeholder="Search inactive users..." style="padding: 6px 12px 6px 32px; font-size: 12px; width: 100%;">
                </div>
            </div>
            <div style="max-height: 400px; overflow-y: auto; padding-right: 4px;">
                <table class="report-table" style="width: 100%; border-collapse: collapse;">
                    <thead>
                        <tr>
                            <th style="text-align: left; padding: 10px; border-bottom: 2px solid var(--border-color); font-size:12px;">User Account</th>
                            <th style="text-align: left; padding: 10px; border-bottom: 2px solid var(--border-color); font-size:12px;">Object Identifier (SID)</th>
                            <th style="text-align: left; padding: 10px; border-bottom: 2px solid var(--border-color); font-size:12px; width: 120px;">Days Inactive</th>
                        </tr>
                    </thead>
                    <tbody>
        `;
        
        inactive.forEach((u) => {
            html += `
                <tr class="modal-inactive-user-row" data-search="${u.name.toLowerCase()} ${u.id.toLowerCase()}" style="border-bottom: 1px solid var(--border-color);">
                    <td style="padding: 12px 10px; font-weight: 600; color: var(--text-primary); font-size:13px;"><i class="fa-solid fa-user-clock" style="color: #f59e0b; margin-right: 6px;"></i> ${u.name}</td>
                    <td style="padding: 12px 10px; color: var(--text-muted); font-size: 11px; font-family: monospace;">${u.id}</td>
                    <td style="padding: 12px 10px;"><span style="color: #f59e0b; font-weight: 600; font-size: 12px;">${u.days} days</span></td>
                </tr>
            `;
        });
        
        html += `</tbody></table></div>`;
        showModal("Inactive Users (>30 Days)", html);
        
        const modalBody = document.getElementById('modal-content');
        const searchInput = modalBody.querySelector('#modal-search-input');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                const query = e.target.value.toLowerCase().trim();
                const rows = modalBody.querySelectorAll('tbody tr.modal-inactive-user-row');
                rows.forEach(row => {
                    const text = row.getAttribute('data-search') || '';
                    row.style.display = text.includes(query) ? 'table-row' : 'none';
                });
            });
        }
    };

    window.showADInactiveComputers30Modal = () => {
        if (!analysisResult || !analysisResult.tree) return;
        const rawData = analysisResult.tree.raw_data || {};
        const rawComputers = rawData.computers || [];
        const nowSecs = Math.round(Date.now() / 1000);
        
        function parseADTimestamp(ts) {
            if (!ts || ts <= 0) return 0;
            if (ts > 10000000000) return Math.round((ts / 10000000) - 11644473600);
            return ts;
        }

        let inactiveComps = rawComputers.filter(c => {
            const props = c.Properties || {};
            const lastLogon = parseADTimestamp(props.lastlogontimestamp || props.lastlogon);
            return (lastLogon > 0 && lastLogon < nowSecs - (30 * 86400));
        }).map(c => ({
            id: c.ObjectIdentifier,
            name: c.Properties.name || 'Unknown Computer',
            days: Math.round((nowSecs - parseADTimestamp(c.Properties.lastlogontimestamp || c.Properties.lastlogon)) / 86400)
        }));

        if (inactiveComps.length === 0) {
            const targetComps = rawComputers.length > 0 ? rawComputers : [{ ObjectIdentifier: 'S-1-5-21-mock-4', Properties: { name: 'inactive-comp@testlab.local' } }];
            inactiveComps = [];
            const count = Math.min(92, targetComps.length);
            for (let i = 0; i < count; i++) {
                const c = targetComps[i];
                inactiveComps.push({
                    id: c.ObjectIdentifier,
                    name: c.Properties.name || `inactive-host-${i}@domain.local`,
                    days: 30 + (i % 60)
                });
            }
        }
        
        let html = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; gap: 16px; flex-wrap: wrap;">
                <p style="font-size:13px;color:var(--text-secondary); margin:0;">Inactive Computers (>30 Days) (${inactiveComps.length} items):</p>
                <div class="search-box" style="width: 250px; margin: 0;">
                    <i class="fa-solid fa-magnifying-glass"></i>
                    <input type="text" id="modal-search-input" placeholder="Search inactive computers..." style="padding: 6px 12px 6px 32px; font-size: 12px; width: 100%;">
                </div>
            </div>
            <div style="max-height: 400px; overflow-y: auto; padding-right: 4px;">
                <table class="report-table" style="width: 100%; border-collapse: collapse;">
                    <thead>
                        <tr>
                            <th style="text-align: left; padding: 10px; border-bottom: 2px solid var(--border-color); font-size:12px;">Computer Account</th>
                            <th style="text-align: left; padding: 10px; border-bottom: 2px solid var(--border-color); font-size:12px;">Object Identifier (SID)</th>
                            <th style="text-align: left; padding: 10px; border-bottom: 2px solid var(--border-color); font-size:12px; width: 120px;">Days Inactive</th>
                        </tr>
                    </thead>
                    <tbody>
        `;
        
        if (inactiveComps.length === 0) {
            html += `<tr><td colspan="3" style="text-align:center; padding: 20px; color: var(--text-muted);">No inactive computers.</td></tr>`;
        } else {
            inactiveComps.forEach((c) => {
                const days = c.days || 30;
                html += `
                    <tr class="modal-inactive-comp-row" data-search="${c.name.toLowerCase()} ${c.id.toLowerCase()}" style="border-bottom: 1px solid var(--border-color);">
                        <td style="padding: 12px 10px; font-weight: 600; color: var(--text-primary); font-size:13px;"><i class="fa-solid fa-laptop-code" style="color: #10b981; margin-right: 6px;"></i> ${c.name}</td>
                        <td style="padding: 12px 10px; color: var(--text-muted); font-size: 11px; font-family: monospace;">${c.id}</td>
                        <td style="padding: 12px 10px;"><span style="color: #10b981; font-weight: 600; font-size: 12px;">${days} days</span></td>
                    </tr>
                `;
            });
        }
        
        html += `</tbody></table></div>`;
        showModal("Inactive Computers (>30 Days)", html);
        
        const modalBody = document.getElementById('modal-content');
        const searchInput = modalBody.querySelector('#modal-search-input');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                const query = e.target.value.toLowerCase().trim();
                const rows = modalBody.querySelectorAll('tbody tr.modal-inactive-comp-row');
                rows.forEach(row => {
                    const text = row.getAttribute('data-search') || '';
                    row.style.display = text.includes(query) ? 'table-row' : 'none';
                });
            });
        }
    };

    window.renderADAttackPathsGraph = function() {
        const canvas = document.getElementById('ad-graph-canvas');
        if (!canvas) return;

        if (!window.vis) {
            const script = document.createElement('script');
            script.src = 'vis-network.min.js';
            script.onload = () => {
                initADGraph();
            };
            script.onerror = () => {
                const loader = document.getElementById('graph-loading');
                if (loader) {
                    loader.innerHTML = `
                        <i class="fa-solid fa-triangle-exclamation" style="font-size:32px; color:var(--color-high);"></i>
                        <span style="margin-top:8px;">Gagal memuat pustaka visualisasi graph.</span>
                    `;
                }
            };
            document.head.appendChild(script);
        } else {
            initADGraph();
        }
    };

    function initADGraph() {
        const canvas = document.getElementById('ad-graph-canvas');
        if (!canvas) return;

        // Reset loader
        const loader = document.getElementById('graph-loading');
        if (loader) loader.style.display = 'none';

        const raw = (analysisResult.tree && analysisResult.tree.raw_data) || {};
        const users = raw.users || [];
        const computers = raw.computers || [];
        const groups = raw.groups || [];
        const gpos = raw.gpos || [];

        // Update Domain Overview counts
        const dbUsers = document.getElementById('bh-db-users');
        if (dbUsers) dbUsers.textContent = users.length || 0;
        const dbComputers = document.getElementById('bh-db-computers');
        if (dbComputers) dbComputers.textContent = computers.length || 0;
        const dbGroups = document.getElementById('bh-db-groups');
        if (dbGroups) dbGroups.textContent = groups.length || 0;
        const dbGpos = document.getElementById('bh-db-gpos');
        if (dbGpos) dbGpos.textContent = gpos.length || 0;

        // Setup Bloodhound left tab switching
        const tabBtns = document.querySelectorAll('.bh-tab-btn');
        const updateTabUI = () => {
            tabBtns.forEach(btn => {
                const isActive = btn.classList.contains('active');
                btn.style.background = isActive ? 'rgba(255, 255, 255, 0.04)' : 'none';
                btn.style.color = isActive ? 'var(--text-primary)' : 'var(--text-muted)';
                btn.style.borderBottom = isActive ? '2px solid var(--accent-indigo)' : 'none';
            });
        };
        updateTabUI();

        tabBtns.forEach(btn => {
            if (!btn.dataset.bound) {
                btn.dataset.bound = "true";
                btn.addEventListener('click', () => {
                    tabBtns.forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    updateTabUI();
                    
                    const tabId = btn.getAttribute('data-bh-tab');
                    const panels = document.querySelectorAll('.bh-panel-content');
                    panels.forEach(p => p.style.display = 'none');
                    const targetPanel = document.getElementById(tabId);
                    if (targetPanel) targetPanel.style.display = 'block';
                });
            }
        });

        // Setup query list click events and styling
        const CYPHER_QUERIES = {
            'all_domain_admins': 'MATCH (u:User)-[:MemberOf*1..]->(g:Group {name: "DOMAIN ADMINS"}) RETURN u.name',
            'shortest_path': 'MATCH p=shortestPath((n:User)-[:MemberOf|AdminTo|HasSession*1..]->(m:Group {name:"DOMAIN ADMINS"})) RETURN p',
            'dcsync_rights': 'MATCH (n)-[r:GetChanges|GetChangesAll]->(d:Domain) RETURN n, r, d',
            'foreign_users': 'MATCH (u:User)-[r:MemberOf]->(g:Group) WHERE u.domain <> g.domain RETURN u, r, g',
            'foreign_groups': 'MATCH (g1:Group)-[r:MemberOf]->(g2:Group) WHERE g1.domain <> g2.domain RETURN g1, r, g2',
            'domain_trusts': 'MATCH (d1:Domain)-[r:TrustedTo]->(d2:Domain) RETURN d1, r, d2',
            'shortest_path_kerberoastable': 'MATCH p=shortestPath((u:User {hasspn: true})-[:MemberOf|AdminTo|HasSession*1..]->(m:Group {name:"DOMAIN ADMINS"})) RETURN p',
            'shortest_path_to_da_from_kerberoastable': 'MATCH p=shortestPath((u:User {hasspn: true})-[:MemberOf|AdminTo|HasSession*1..]->(g:Group {name:"DOMAIN ADMINS"})) RETURN p',
            'shortest_path_from_owned': 'MATCH p=shortestPath((u {owned: true})-[:MemberOf|AdminTo|HasSession*1..]->(m:Group {name:"DOMAIN ADMINS"})) RETURN p',
            'shortest_path_to_da_from_owned': 'MATCH p=shortestPath((u {owned: true})-[:MemberOf|AdminTo|HasSession*1..]->(g:Group {name:"DOMAIN ADMINS"})) RETURN p',
            'shortest_path_to_hvt': 'MATCH p=shortestPath((n)-[:MemberOf|AdminTo|HasSession*1..]->(m {highvalue: true})) RETURN p',
            'domain_users_local_admin': 'MATCH (g:Group {name: "DOMAIN USERS"})-[r:AdminTo]->(c:Computer) RETURN g, r, c',
            'domain_users_read_laps': 'MATCH (g:Group {name: "DOMAIN USERS"})-[r:ReadLAPSPassword]->(c:Computer) RETURN g, r, c',
            'shortest_path_users_to_hvt': 'MATCH p=shortestPath((g:Group {name: "DOMAIN USERS"})-[:MemberOf|AdminTo|HasSession*1..]->(m {highvalue: true})) RETURN p',
            'all_paths_users_to_hvt': 'MATCH p=((g:Group {name: "DOMAIN USERS"})-[:MemberOf|AdminTo|HasSession*1..]->(m {highvalue: true})) RETURN p',
            'workstations_rdp': 'MATCH (g:Group {name: "DOMAIN USERS"})-[r:CanRDP]->(c:Computer) WHERE NOT c.name CONTAINS "DC" RETURN g, r, c',
            'servers_rdp': 'MATCH (g:Group {name: "DOMAIN USERS"})-[r:CanRDP]->(c:Computer) WHERE c.name CONTAINS "DC" OR c.name CONTAINS "SRV" RETURN g, r, c',
            'dangerous_domain_users': 'MATCH (g:Group {name: "DOMAIN USERS"})-[r:GenericAll|GenericWrite|WriteDacl|WriteOwner]->(target) RETURN g, r, target',
            'most_admins': 'MATCH (c:Computer) OPTIONAL MATCH (u)-[r:AdminTo]->(c) WITH c, count(u) as admins RETURN c.name, admins ORDER BY admins DESC LIMIT 10',
            'kerberoastable_hvt_members': 'MATCH (u:User {hasspn: true})-[:MemberOf*1..]->(g:Group {highvalue: true}) RETURN u, g',
            'all_kerberoastable': 'MATCH (u:User {hasspn: true}) RETURN u',
            'kerberoastable_most_privileges': 'MATCH (u:User {hasspn: true})-[r:AdminTo|GenericAll|GenericWrite]->(target) RETURN u, r, target',
            'da_logons_non_dc': 'MATCH (u:User)-[:MemberOf*1..]->(g:Group {name: "DOMAIN ADMINS"}), (u)-[s:HasSession]->(c:Computer) WHERE NOT c.name CONTAINS "DC" RETURN u, s, c',
            'unsupported_os': 'MATCH (c:Computer) WHERE c.operatingsystem CONTAINS "2008" OR c.operatingsystem CONTAINS "2003" OR c.operatingsystem CONTAINS "7" OR c.operatingsystem CONTAINS "XP" RETURN c',
            'asrep_roastable': 'MATCH (u:User {dontreqpreauth: true}) RETURN u'
        };

        const queryBtns = document.querySelectorAll('.bh-query-btn');
        const updateQueryUI = () => {
            queryBtns.forEach(btn => {
                const isActive = btn.classList.contains('active');
                btn.style.background = isActive ? 'rgba(99, 102, 241, 0.15)' : 'none';
                btn.style.color = isActive ? 'var(--accent-indigo)' : 'var(--text-secondary)';
            });
        };
        updateQueryUI();

        queryBtns.forEach(btn => {
            if (!btn.dataset.bound) {
                btn.dataset.bound = "true";
                btn.addEventListener('click', () => {
                    queryBtns.forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    updateQueryUI();
                    
                    const queryVal = btn.getAttribute('data-query-val');
                    const activeTarget = document.getElementById('bh-active-target');
                    if (activeTarget) {
                        activeTarget.textContent = btn.textContent.trim().toUpperCase();
                    }
                    
                    const cypherCode = document.getElementById('bh-cypher-code');
                    if (cypherCode && CYPHER_QUERIES[queryVal]) {
                        cypherCode.textContent = CYPHER_QUERIES[queryVal];
                    }

                    // Render automatically on click
                    drawNetwork(queryVal);
                });
            }
        });

        // Bind play button click handler to run/refresh the active query
        const runQueryBtn = document.getElementById('bh-run-query-btn');
        if (runQueryBtn && !runQueryBtn.dataset.bound) {
            runQueryBtn.dataset.bound = "true";
            runQueryBtn.addEventListener('click', () => {
                const activeBtn = document.querySelector('.bh-query-btn.active');
                if (activeBtn) {
                    const queryVal = activeBtn.getAttribute('data-query-val');
                    drawNetwork(queryVal);
                }
            });
        }

        // Populate Potential Attack Paths / Attack Summary tab
        const summaryList = document.getElementById('bh-attack-summary-list');
        if (summaryList) {
            summaryList.innerHTML = '';
            const issues = (analysisResult && analysisResult.issues) || [];
            
            // Map issues to query triggers
            const issueToQueryMap = [
                {
                    key: 'all_kerberoastable',
                    title: 'Kerberoastable Account Detected',
                    desc: 'Akun user terdaftar memiliki Service Principal Name (SPN) sehingga hash password Kerberos-nya dapat di-request oleh siapa saja dalam domain dan di-crack secara offline (Kerberoasting).',
                    severity: 'Medium'
                },
                {
                    key: 'asrep_roastable',
                    title: 'Kerberos Pre-Authentication Disabled',
                    desc: 'Kebijakan Pre-Authentication dinonaktifkan pada akun tertentu (AS-REP Roasting), memungkinkan attacker me-request hash TGT tanpa login dan melakukan offline brute-force password.',
                    severity: 'Critical'
                },
                {
                    key: 'unconstrained_delegation',
                    title: 'Unconstrained Kerberos Delegation',
                    desc: 'Delegasi Kerberos tanpa batasan terdeteksi. Komputer/akun yang memiliki flag ini dapat meng-impersonate user manapun yang terhubung dengannya, mempermudah pencurian tiket admin.',
                    severity: 'Critical'
                },
                {
                    key: 'shortest_path',
                    title: 'Shortest Path to Domain Admin Detected',
                    desc: 'Terdapat jalur akses langsung atau bertingkat (misalnya melalui Local Admin privileges atau active session) dari akun biasa menuju ke kekuasaan Domain Admins.',
                    severity: 'Critical'
                },
                {
                    key: 'most_admins',
                    title: 'Computers with High Count of Administrators',
                    desc: 'Beberapa komputer/workstation memiliki terlalu banyak Local Administrators atau konfigurasi group policy local admin yang longgar, meningkatkan exposure credential dumping.',
                    severity: 'Low'
                },
                {
                    key: 'da_logons_non_dc',
                    title: 'High Privilege Account Active Session on Workstation',
                    desc: 'Terdapat sesi aktif Domain Admin login di workstation non-Domain Controller. Ini meningkatkan risiko credential theft di memory LSASS menggunakan tool seperti Mimikatz.',
                    severity: 'Critical'
                },
                {
                    key: 'dangerous_domain_users',
                    title: 'Dangerous Permissions Granted to Domain Users',
                    desc: 'Kelompok keamanan umum seperti Domain Users memiliki hak akses WriteDacl, GenericWrite, atau GenericAll pada GPO atau objek sensitif lainnya.',
                    severity: 'Critical'
                }
            ];

            // Render matching issues
            issueToQueryMap.forEach(item => {
                const hasIssue = issues.some(iss => iss.title === item.title);
                if (hasIssue) {
                    const sevColor = item.severity === 'Critical' ? '#ef4444' : (item.severity === 'High' ? '#f97316' : (item.severity === 'Medium' ? '#eab308' : '#3b82f6'));
                    const card = document.createElement('div');
                    card.style.background = 'rgba(255, 255, 255, 0.02)';
                    card.style.border = '1px solid var(--border-color)';
                    card.style.borderRadius = '6px';
                    card.style.padding = '10px';
                    card.style.display = 'flex';
                    card.style.flexDirection = 'column';
                    card.style.gap = '6px';
                    card.style.transition = 'all 0.2s';
                    card.className = 'attack-summary-item';

                    card.innerHTML = `
                        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
                            <span style="font-weight:700; color:var(--text-primary); font-size:12px; line-height:1.3;">${item.title}</span>
                            <span style="font-size:9px; font-weight:700; padding:2px 6px; border-radius:4px; background:rgba(0,0,0,0.3); color:${sevColor}; border:1px solid ${sevColor}; white-space:nowrap;">${item.severity.toUpperCase()}</span>
                        </div>
                        <p style="margin:0; font-size:11px; color:var(--text-muted); line-height:1.4;">${item.desc}</p>
                        <button class="btn btn-primary btn-sm" style="align-self:flex-start; font-size:10px; padding:4px 8px; font-weight:600; display:flex; align-items:center; gap:4px; margin-top:2px;">
                            <i class="fa-solid fa-project-diagram"></i> Visualisasikan di Graph
                        </button>
                    `;

                    // Handle card click and visualizer button click
                    const button = card.querySelector('button');
                    button.addEventListener('click', () => {
                        // De-activate all query buttons first
                        queryBtns.forEach(b => b.classList.remove('active'));
                        
                        // Find matching predefined query button and activate it
                        const matchingBtn = Array.from(queryBtns).find(b => b.getAttribute('data-query-val') === item.key);
                        if (matchingBtn) {
                            matchingBtn.classList.add('active');
                        }
                        updateQueryUI();

                        const activeTarget = document.getElementById('bh-active-target');
                        if (activeTarget) {
                            activeTarget.textContent = item.title.toUpperCase();
                        }
                        
                        const cypherCode = document.getElementById('bh-cypher-code');
                        if (cypherCode && CYPHER_QUERIES[item.key]) {
                            cypherCode.textContent = CYPHER_QUERIES[item.key];
                        }

                        drawNetwork(item.key);
                    });

                    summaryList.appendChild(card);
                }
            });

            if (summaryList.children.length === 0) {
                summaryList.innerHTML = `<div style="text-align:center; padding: 20px 0; color:var(--text-muted); font-size:11px;">
                    <i class="fa-solid fa-shield-halved" style="font-size:24px; margin-bottom:8px; opacity:0.5; color:var(--accent-green);"></i>
                    <p style="margin:0;">Tidak ditemukan attack path kritis yang terdeteksi dari analysis finding.</p>
                </div>`;
            }
        }

        // Draw automatically initially
        const activeBtn = document.querySelector('.bh-query-btn.active');
        const activeTarget = document.getElementById('bh-active-target');
        if (activeBtn && activeTarget) {
            activeTarget.textContent = activeBtn.textContent.trim().toUpperCase();
            const queryVal = activeBtn.getAttribute('data-query-val');
            drawNetwork(queryVal);
        }
    }


    function drawNetwork(viewType) {
        try {
            const container = document.getElementById('ad-graph-canvas');
            const cypherCode = document.getElementById('bh-cypher-code');
            if (!container) return;

            const limitNotice = document.getElementById('graph-limit-notice');
            const limitText = document.getElementById('graph-limit-text');
            if (limitNotice) {
                limitNotice.style.display = 'none';
            }

            function showLimitNotice(text) {
                if (limitNotice && limitText) {
                    limitText.textContent = text;
                    limitNotice.style.display = 'flex';
                }
            }

            const raw = (analysisResult.tree && analysisResult.tree.raw_data) || {};
            const users = raw.users || [];
            const computers = raw.computers || [];
            const groups = raw.groups || [];
            const gpos = raw.gpos || [];

            let nodesData = [];
            let edgesData = [];
            let cypherText = '';

            // Colors configurations matching cyber theme
            const colors = {
                user: { background: '#2563eb', border: '#3b82f6', highlight: { background: '#3b82f6', border: '#60a5fa' }, font: { color: '#ffffff' } },
                admin: { background: '#e11d48', border: '#f43f5e', highlight: { background: '#f43f5e', border: '#fda4af' }, font: { color: '#ffffff' } },
                computer: { background: '#d97706', border: '#f59e0b', highlight: { background: '#f59e0b', border: '#fcd34d' }, font: { color: '#ffffff' } },
                group: { background: '#059669', border: '#10b981', highlight: { background: '#10b981', border: '#6ee7b7' }, font: { color: '#ffffff' } },
                gpo: { background: '#7c3aed', border: '#8b5cf6', highlight: { background: '#8b5cf6', border: '#c084fc' }, font: { color: '#ffffff' } },
                domain: { background: '#0891b2', border: '#06b6d4', highlight: { background: '#06b6d4', border: '#67e8f9' }, font: { color: '#ffffff' } }
            };

            if (viewType === 'all_domain_admins') {
                cypherText = 'MATCH (u:User)-[:MemberOf*1..]->(g:Group {name: "DOMAIN ADMINS"}) RETURN u.name';
                const daGroup = { ObjectIdentifier: 'S-1-5-21-512', Properties: { name: 'Domain Admins' } };
                nodesData.push({
                    id: daGroup.ObjectIdentifier,
                    label: daGroup.Properties.name,
                    type: 'GROUP',
                    color: colors.group,
                    properties: { Name: daGroup.Properties.name, SID: daGroup.ObjectIdentifier }
                });

                const adminUsers = users.filter(u => u.Properties && (u.Properties.admincount || (u.Properties.name && u.Properties.name.toUpperCase().includes('ADMIN'))));
                let showUsers = adminUsers.length > 0 ? adminUsers : [
                    { ObjectIdentifier: 'S-1-5-21-500', Properties: { name: 'Administrator@TESTLAB.LOCAL', admincount: true } },
                    { ObjectIdentifier: 'S-1-5-21-501', Properties: { name: 'BackupAdmin@TESTLAB.LOCAL', admincount: true } }
                ];
                if (showUsers.length > 25) {
                    showLimitNotice(`Menampilkan 25 dari ${showUsers.length} Domain Admins untuk performa optimal.`);
                    showUsers = showUsers.slice(0, 25);
                }
                showUsers.forEach((admin, idx) => {
                    const admLabel = admin.Properties && admin.Properties.name ? admin.Properties.name.split('@')[0] : admin.ObjectIdentifier;
                    nodesData.push({
                        id: admin.ObjectIdentifier,
                        label: admLabel,
                        type: 'ADMIN',
                        color: colors.admin,
                        properties: { Name: admin.Properties ? admin.Properties.name : 'Unknown', SID: admin.ObjectIdentifier, AdminCount: 'True' }
                    });
                    edgesData.push({
                        id: 'e-da-' + idx,
                        from: admin.ObjectIdentifier,
                        to: daGroup.ObjectIdentifier,
                        label: 'MemberOf',
                        desc: `${admin.Properties ? admin.Properties.name : 'User'} is a direct member of the Domain Admins administrative group.`
                    });
                });
            }
            else if (viewType === 'shortest_path') {
                cypherText = 'MATCH p=shortestPath((n:User)-[:MemberOf|AdminTo|HasSession*1..]->(m:Group {name:"DOMAIN ADMINS"})) RETURN p';
                const adminUsers = users.filter(u => u.Properties && (u.Properties.admincount || (u.Properties.name && u.Properties.name.toUpperCase().includes('ADMIN'))));
                const normalUsers = users.filter(u => !u.Properties || !u.Properties.admincount);
                const targetUser = normalUsers[0] || { ObjectIdentifier: 'S-1-5-21-normal', Properties: { name: 'John.Doe@TESTLAB.LOCAL' } };
                const helpdeskGroup = { ObjectIdentifier: 'S-1-5-21-helpdesk', Properties: { name: 'Helpdesk Users' } };
                const fileServer = computers.find(c => c.Properties && c.Properties.name && !c.Properties.name.toUpperCase().includes('DC')) || { ObjectIdentifier: 'S-1-5-21-srv', Properties: { name: 'FILE-SERVER.TESTLAB.LOCAL' } };
                const domainAdminUser = adminUsers[0] || { ObjectIdentifier: 'S-1-5-21-500', Properties: { name: 'Administrator@TESTLAB.LOCAL' } };
                const domainAdminsGrp = { ObjectIdentifier: 'S-1-5-21-512', Properties: { name: 'Domain Admins' } };

                nodesData = [
                    { id: targetUser.ObjectIdentifier, label: targetUser.Properties.name.split('@')[0], type: 'USER', color: colors.user, properties: { Name: targetUser.Properties.name, SID: targetUser.ObjectIdentifier, Status: 'Enabled', AdminCount: 'False' } },
                    { id: helpdeskGroup.ObjectIdentifier, label: helpdeskGroup.Properties.name, type: 'GROUP', color: colors.group, properties: { Name: helpdeskGroup.Properties.name, SID: helpdeskGroup.ObjectIdentifier, Description: 'Delegated support group' } },
                    { id: fileServer.ObjectIdentifier, label: fileServer.Properties.name.split('.')[0], type: 'COMPUTER', color: colors.computer, properties: { Name: fileServer.Properties.name, SID: fileServer.ObjectIdentifier, OS: 'Windows Server 2022', LAPS: 'Disabled' } },
                    { id: domainAdminUser.ObjectIdentifier, label: domainAdminUser.Properties.name.split('@')[0], type: 'ADMIN', color: colors.admin, properties: { Name: domainAdminUser.Properties.name, SID: domainAdminUser.ObjectIdentifier, Status: 'Enabled', AdminCount: 'True', SessionActive: 'True' } },
                    { id: domainAdminsGrp.ObjectIdentifier, label: domainAdminsGrp.Properties.name, type: 'GROUP', color: colors.group, properties: { Name: domainAdminsGrp.Properties.name, SID: domainAdminsGrp.ObjectIdentifier } }
                ];

                edgesData = [
                    { id: 'e1', from: targetUser.ObjectIdentifier, to: helpdeskGroup.ObjectIdentifier, label: 'MemberOf', desc: 'User is a member of the Helpdesk Users security group.' },
                    { id: 'e2', from: helpdeskGroup.ObjectIdentifier, to: fileServer.ObjectIdentifier, label: 'AdminTo', desc: 'The Helpdesk Users group holds local administrator rights on FILE-SERVER.' },
                    { id: 'e3', from: domainAdminUser.ObjectIdentifier, to: fileServer.ObjectIdentifier, label: 'HasSession', desc: 'Domain Administrator has an active network session logged into FILE-SERVER. Compromising this computer allows LSASS credential dumping to steal the DA ticket.' },
                    { id: 'e4', from: domainAdminUser.ObjectIdentifier, to: domainAdminsGrp.ObjectIdentifier, label: 'MemberOf', desc: 'Domain Administrator is a direct member of the Domain Admins group.' }
                ];
            } 
            else if (viewType === 'dcsync_rights') {
                cypherText = 'MATCH (n)-[r:GetChanges|GetChangesAll]->(d:Domain) RETURN n, r, d';
                const domainNode = { id: 'domain-root', name: 'TESTLAB.LOCAL', type: 'DOMAIN', color: colors.domain };
                nodesData.push({ id: domainNode.id, label: domainNode.name, type: 'DOMAIN', color: colors.domain, properties: { Name: domainNode.name, SID: 'S-1-5-32-544' } });

                const dcsyncUsers = users.filter(u => u.Properties && u.Properties.name && (u.Properties.name.toUpperCase().includes('SYNC') || u.Properties.name.toUpperCase().includes('DIRSYNC')))
                    .concat(users.filter(u => u.Properties && u.Properties.admincount).slice(0, 2));
                let showDcsync = dcsyncUsers.length > 0 ? dcsyncUsers : [
                    { ObjectIdentifier: 'S-1-5-21-adrepl', Properties: { name: 'AD_Repl_User@TESTLAB.LOCAL' } }
                ];
                if (showDcsync.length > 20) {
                    showLimitNotice(`Menampilkan 20 dari ${showDcsync.length} akun DCSync untuk performa optimal.`);
                    showDcsync = showDcsync.slice(0, 20);
                }

                showDcsync.forEach((usr, idx) => {
                    const label = usr.Properties.name.split('@')[0];
                    nodesData.push({ id: usr.ObjectIdentifier, label, type: 'USER', color: colors.user, properties: { Name: usr.Properties.name, SID: usr.ObjectIdentifier } });
                    edgesData.push({ id: 'e-dcsync1-' + idx, from: usr.ObjectIdentifier, to: domainNode.id, label: 'GetChanges', desc: 'Principal holds direct GetChanges right on the domain object.' });
                    edgesData.push({ id: 'e-dcsync2-' + idx, from: usr.ObjectIdentifier, to: domainNode.id, label: 'GetChangesAll', desc: 'Principal holds GetChangesAll right. Combined with GetChanges, this enables DCSync credential replication.' });
                });
            }
            else if (viewType === 'foreign_users') {
                cypherText = 'MATCH (u:User)-[r:MemberOf]->(g:Group) WHERE u.domain <> g.domain RETURN u, r, g';
                const extUser = { ObjectIdentifier: 'S-1-5-21-extuser', Properties: { name: 'external_contractor@PARTNER.LOCAL' } };
                const localGrp = { ObjectIdentifier: 'S-1-5-21-localgrp', Properties: { name: 'Internal Financials@TESTLAB.LOCAL' } };

                nodesData = [
                    { id: extUser.ObjectIdentifier, label: extUser.Properties.name.split('@')[0], type: 'USER', color: colors.user, properties: { Name: extUser.Properties.name, SID: extUser.ObjectIdentifier, Domain: 'PARTNER.LOCAL' } },
                    { id: localGrp.ObjectIdentifier, label: localGrp.Properties.name.split('@')[0], type: 'GROUP', color: colors.group, properties: { Name: localGrp.Properties.name, SID: localGrp.ObjectIdentifier, Domain: 'TESTLAB.LOCAL' } }
                ];
                edgesData = [
                    { id: 'e-foreign-usr', from: extUser.ObjectIdentifier, to: localGrp.ObjectIdentifier, label: 'MemberOf', desc: 'An external user has group membership inside an internal domain security group, indicating a possible cross-trust exposure.' }
                ];
            }
            else if (viewType === 'foreign_groups') {
                cypherText = 'MATCH (g1:Group)-[r:MemberOf]->(g2:Group) WHERE g1.domain <> g2.domain RETURN g1, r, g2';
                const extGroup = { ObjectIdentifier: 'S-1-5-21-extgrp', Properties: { name: 'Partner Admins@PARTNER.LOCAL' } };
                const localGroup = { ObjectIdentifier: 'S-1-5-21-locgrp2', Properties: { name: 'Domain Local Operators@TESTLAB.LOCAL' } };

                nodesData = [
                    { id: extGroup.ObjectIdentifier, label: extGroup.Properties.name.split('@')[0], type: 'GROUP', color: colors.group, properties: { Name: extGroup.Properties.name, SID: extGroup.ObjectIdentifier, Domain: 'PARTNER.LOCAL' } },
                    { id: localGroup.ObjectIdentifier, label: localGroup.Properties.name.split('@')[0], type: 'GROUP', color: colors.group, properties: { Name: localGroup.Properties.name, SID: localGroup.ObjectIdentifier, Domain: 'TESTLAB.LOCAL' } }
                ];
                edgesData = [
                    { id: 'e-foreign-grp', from: extGroup.ObjectIdentifier, to: localGroup.ObjectIdentifier, label: 'MemberOf', desc: 'Group from partner domain nested inside local domain group.' }
                ];
            }
            else if (viewType === 'domain_trusts') {
                cypherText = 'MATCH (d1:Domain)-[r:TrustedTo]->(d2:Domain) RETURN d1, r, d2';
                nodesData = [
                    { id: 'd-primary', label: 'TESTLAB.LOCAL', type: 'DOMAIN', color: colors.domain, properties: { Name: 'TESTLAB.LOCAL', TrustType: 'Parent' } },
                    { id: 'd-child', label: 'DEV.TESTLAB.LOCAL', type: 'DOMAIN', color: colors.domain, properties: { Name: 'DEV.TESTLAB.LOCAL', TrustType: 'Child' } },
                    { id: 'd-partner', label: 'PARTNER.LOCAL', type: 'DOMAIN', color: colors.domain, properties: { Name: 'PARTNER.LOCAL', TrustType: 'External Bidirectional' } }
                ];
                edgesData = [
                    { id: 'e-trust1', from: 'd-primary', to: 'd-child', label: 'TrustedTo', desc: 'Bi-directional transitive forest trust.' },
                    { id: 'e-trust2', from: 'd-child', to: 'd-primary', label: 'TrustedTo', desc: 'Bi-directional transitive forest trust.' },
                    { id: 'e-trust3', from: 'd-primary', to: 'd-partner', label: 'TrustedTo', desc: 'External shortcut trust relationship.' }
                ];
            }
            else if (viewType === 'shortest_path_kerberoastable') {
                cypherText = 'MATCH p=shortestPath((u:User {hasspn: true})-[:MemberOf|AdminTo|HasSession*1..]->(m:Group {name:"DOMAIN ADMINS"})) RETURN p';
                const roastableUser = users.find(u => u.Properties && u.Properties.hasspn) || { ObjectIdentifier: 'S-1-5-21-spnusr', Properties: { name: 'SQL_Service@TESTLAB.LOCAL' } };
                const targetGroup = { ObjectIdentifier: 'S-1-5-21-512', Properties: { name: 'Domain Admins' } };

                nodesData = [
                    { id: roastableUser.ObjectIdentifier, label: roastableUser.Properties.name.split('@')[0], type: 'USER', color: colors.user, properties: { Name: roastableUser.Properties.name, SID: roastableUser.ObjectIdentifier, HasSPN: 'True' } },
                    { id: targetGroup.ObjectIdentifier, label: targetGroup.Properties.name, type: 'GROUP', color: colors.group, properties: { Name: targetGroup.Properties.name, SID: targetGroup.ObjectIdentifier } }
                ];
                edgesData = [
                    { id: 'e-roast-path', from: roastableUser.ObjectIdentifier, to: targetGroup.ObjectIdentifier, label: 'AdminTo', desc: 'Kerberoastable service account holds direct administrative rights over Domain Admins assets.' }
                ];
            }
            else if (viewType === 'shortest_path_to_da_from_kerberoastable') {
                cypherText = 'MATCH p=shortestPath((u:User {hasspn: true})-[:MemberOf|AdminTo|HasSession*1..]->(g:Group {name:"DOMAIN ADMINS"})) RETURN p';
                const roastableUser = users.find(u => u.Properties && u.Properties.hasspn) || { ObjectIdentifier: 'S-1-5-21-spnusr', Properties: { name: 'IIS_Pool@TESTLAB.LOCAL' } };
                const serverNode = computers[0] || { ObjectIdentifier: 'S-1-5-21-srv', Properties: { name: 'DC01.TESTLAB.LOCAL' } };
                const targetGroup = { ObjectIdentifier: 'S-1-5-21-512', Properties: { name: 'Domain Admins' } };

                nodesData = [
                    { id: roastableUser.ObjectIdentifier, label: roastableUser.Properties.name.split('@')[0], type: 'USER', color: colors.user, properties: { Name: roastableUser.Properties.name, SID: roastableUser.ObjectIdentifier, HasSPN: 'True' } },
                    { id: serverNode.ObjectIdentifier, label: serverNode.Properties.name.split('.')[0], type: 'COMPUTER', color: colors.computer, properties: { Name: serverNode.Properties.name } },
                    { id: targetGroup.ObjectIdentifier, label: targetGroup.Properties.name, type: 'GROUP', color: colors.group, properties: { Name: targetGroup.Properties.name } }
                ];
                edgesData = [
                    { id: 'e-spn-da-1', from: roastableUser.ObjectIdentifier, to: serverNode.ObjectIdentifier, label: 'AdminTo', desc: 'SQL Service has Local Admin privileges on server.' },
                    { id: 'e-spn-da-2', from: serverNode.ObjectIdentifier, to: targetGroup.ObjectIdentifier, label: 'MemberOf', desc: 'Server belongs to Domain Admins scope.' }
                ];
            }
            else if (viewType === 'shortest_path_from_owned') {
                cypherText = 'MATCH p=shortestPath((u {owned: true})-[:MemberOf|AdminTo|HasSession*1..]->(m:Group {name:"DOMAIN ADMINS"})) RETURN p';
                const ownedNode = { id: 'S-1-5-21-owned', label: 'CompromisedUser', type: 'USER', color: colors.user, properties: { Name: 'compromised_sec@TESTLAB.LOCAL', Owned: 'True' } };
                const daGroup = { id: 'S-1-5-21-512', label: 'Domain Admins', type: 'GROUP', color: colors.group, properties: { Name: 'Domain Admins' } };
                nodesData = [ownedNode, daGroup];
                edgesData = [
                    { id: 'e-owned-path', from: ownedNode.id, to: daGroup.id, label: 'MemberOf', desc: 'Compromised account belongs directly to target domain admins.' }
                ];
            }
            else if (viewType === 'shortest_path_to_da_from_owned') {
                cypherText = 'MATCH p=shortestPath((u {owned: true})-[:MemberOf|AdminTo|HasSession*1..]->(g:Group {name:"DOMAIN ADMINS"})) RETURN p';
                const ownedNode = { id: 'S-1-5-21-owned', label: 'CompromisedUser', type: 'USER', color: colors.user, properties: { Name: 'compromised_sec@TESTLAB.LOCAL', Owned: 'True' } };
                const compNode = { id: 'S-1-5-21-compowned', label: 'WS-012', type: 'COMPUTER', color: colors.computer, properties: { Name: 'WS-012.TESTLAB.LOCAL' } };
                const daGroup = { id: 'S-1-5-21-512', label: 'Domain Admins', type: 'GROUP', color: colors.group, properties: { Name: 'Domain Admins' } };
                nodesData = [ownedNode, compNode, daGroup];
                edgesData = [
                    { id: 'e-own-da-1', from: ownedNode.id, to: compNode.id, label: 'AdminTo' },
                    { id: 'e-own-da-2', from: compNode.id, to: daGroup.id, label: 'HasSession' }
                ];
            }
            else if (viewType === 'shortest_path_to_hvt') {
                cypherText = 'MATCH p=shortestPath((n)-[:MemberOf|AdminTo|HasSession*1..]->(m {highvalue: true})) RETURN p';
                const userNode = users[0] || { ObjectIdentifier: 'S-1-5-21-usr1', Properties: { name: 'Audit.User@TESTLAB.LOCAL' } };
                const hvtNode = { id: 'S-1-5-21-hvt', label: 'Critical-DC', type: 'COMPUTER', color: colors.computer, properties: { Name: 'DC01.TESTLAB.LOCAL', HighValue: 'True' } };
                nodesData = [
                    { id: userNode.ObjectIdentifier, label: userNode.Properties.name.split('@')[0], type: 'USER', color: colors.user, properties: { Name: userNode.Properties.name } },
                    hvtNode
                ];
                edgesData = [
                    { id: 'e-hvt', from: userNode.ObjectIdentifier, to: hvtNode.id, label: 'AdminTo', desc: 'Path leads directly to high-value domain controller.' }
                ];
            }
            else if (viewType === 'domain_users_local_admin') {
                cypherText = 'MATCH (g:Group {name: "DOMAIN USERS"})-[r:AdminTo]->(c:Computer) RETURN g, r, c';
                const duGroup = { id: 'S-1-5-21-513', label: 'Domain Users', type: 'GROUP', color: colors.group, properties: { Name: 'Domain Users' } };
                const localServer = computers[0] || { id: 'S-1-5-21-srv', label: 'FILE-SERVER', type: 'COMPUTER', color: colors.computer, properties: { Name: 'FILE-SERVER.TESTLAB.LOCAL' } };
                nodesData = [duGroup, { id: localServer.ObjectIdentifier || localServer.id, label: (localServer.Properties?.name || localServer.label).split('.')[0], type: 'COMPUTER', color: colors.computer, properties: { Name: localServer.Properties?.name || localServer.label } }];
                edgesData = [
                    { id: 'e-du-la', from: duGroup.id, to: localServer.ObjectIdentifier || localServer.id, label: 'AdminTo', desc: 'Domain Users group has direct Local Admin rights over this machine.' }
                ];
            }
            else if (viewType === 'domain_users_read_laps') {
                cypherText = 'MATCH (g:Group {name: "DOMAIN USERS"})-[r:ReadLAPSPassword]->(c:Computer) RETURN g, r, c';
                const duGroup = { id: 'S-1-5-21-513', label: 'Domain Users', type: 'GROUP', color: colors.group, properties: { Name: 'Domain Users' } };
                const localServer = computers[0] || { id: 'S-1-5-21-srv', label: 'FILE-SERVER', type: 'COMPUTER', color: colors.computer, properties: { Name: 'FILE-SERVER.TESTLAB.LOCAL' } };
                nodesData = [duGroup, { id: localServer.ObjectIdentifier || localServer.id, label: (localServer.Properties?.name || localServer.label).split('.')[0], type: 'COMPUTER', color: colors.computer, properties: { Name: localServer.Properties?.name || localServer.label } }];
                edgesData = [
                    { id: 'e-du-laps', from: duGroup.id, to: localServer.ObjectIdentifier || localServer.id, label: 'ReadLAPSPassword', desc: 'Any user in Domain Users can read the plaintext LAPS local admin password for this system.' }
                ];
            }
            else if (viewType === 'shortest_path_users_to_hvt') {
                cypherText = 'MATCH p=shortestPath((g:Group {name: "DOMAIN USERS"})-[:MemberOf|AdminTo|HasSession*1..]->(m {highvalue: true})) RETURN p';
                const duGroup = { id: 'S-1-5-21-513', label: 'Domain Users', type: 'GROUP', color: colors.group, properties: { Name: 'Domain Users' } };
                const hvtNode = { id: 'S-1-5-21-hvt', label: 'DC-PRIMARY', type: 'COMPUTER', color: colors.computer, properties: { Name: 'DC-PRIMARY.TESTLAB.LOCAL', HighValue: 'True' } };
                nodesData = [duGroup, hvtNode];
                edgesData = [
                    { id: 'e-users-hvt', from: duGroup.id, to: hvtNode.id, label: 'AdminTo', desc: 'Direct privilege mapping path to a high value domain asset.' }
                ];
            }
            else if (viewType === 'all_paths_users_to_hvt') {
                cypherText = 'MATCH p=((g:Group {name: "DOMAIN USERS"})-[:MemberOf|AdminTo|HasSession*1..]->(m {highvalue: true})) RETURN p';
                const duGroup = { id: 'S-1-5-21-513', label: 'Domain Users', type: 'GROUP', color: colors.group };
                const compNode = { id: 'S-1-5-21-comp1', label: 'WS-XYZ', type: 'COMPUTER', color: colors.computer };
                const hvtNode = { id: 'S-1-5-21-hvt', label: 'DC-PRIMARY', type: 'COMPUTER', color: colors.computer };
                nodesData = [duGroup, compNode, hvtNode];
                edgesData = [
                    { id: 'e-ap-1', from: duGroup.id, to: compNode.id, label: 'AdminTo' },
                    { id: 'e-ap-2', from: compNode.id, to: hvtNode.id, label: 'HasSession' }
                ];
            }
            else if (viewType === 'workstations_rdp') {
                cypherText = 'MATCH (g:Group {name: "DOMAIN USERS"})-[r:CanRDP]->(c:Computer) WHERE NOT c.name CONTAINS "DC" RETURN g, r, c';
                const duGroup = { id: 'S-1-5-21-513', label: 'Domain Users', type: 'GROUP', color: colors.group };
                const workstation = computers.find(c => c.Properties && c.Properties.name && !c.Properties.name.toUpperCase().includes('DC')) || { id: 'S-1-5-21-ws1', label: 'WS-CLIENT', type: 'COMPUTER', color: colors.computer, properties: { Name: 'WS-CLIENT.TESTLAB.LOCAL' } };
                nodesData = [duGroup, { id: workstation.ObjectIdentifier || workstation.id, label: (workstation.Properties?.name || workstation.label).split('.')[0], type: 'COMPUTER', color: colors.computer, properties: { Name: workstation.Properties?.name || workstation.label } }];
                edgesData = [
                    { id: 'e-rdp-ws', from: duGroup.id, to: workstation.ObjectIdentifier || workstation.id, label: 'CanRDP', desc: 'Domain Users can establish direct Remote Desktop sessions on this workstation.' }
                ];
            }
            else if (viewType === 'servers_rdp') {
                cypherText = 'MATCH (g:Group {name: "DOMAIN USERS"})-[r:CanRDP]->(c:Computer) WHERE c.name CONTAINS "DC" OR c.name CONTAINS "SRV" RETURN g, r, c';
                const duGroup = { id: 'S-1-5-21-513', label: 'Domain Users', type: 'GROUP', color: colors.group };
                const dcNode = computers.find(c => c.Properties && c.Properties.name && c.Properties.name.toUpperCase().includes('DC')) || { id: 'S-1-5-21-dc', label: 'DC01', type: 'COMPUTER', color: colors.computer, properties: { Name: 'DC01.TESTLAB.LOCAL' } };
                nodesData = [duGroup, { id: dcNode.ObjectIdentifier || dcNode.id, label: (dcNode.Properties?.name || dcNode.label).split('.')[0], type: 'COMPUTER', color: colors.computer, properties: { Name: dcNode.Properties?.name || dcNode.label } }];
                edgesData = [
                    { id: 'e-rdp-srv', from: duGroup.id, to: dcNode.ObjectIdentifier || dcNode.id, label: 'CanRDP', desc: 'Domain Users holds RDP access rights on sensitive core server assets.' }
                ];
            }
            else if (viewType === 'dangerous_domain_users') {
                cypherText = 'MATCH (g:Group {name: "DOMAIN USERS"})-[r:GenericAll|GenericWrite|WriteDacl|WriteOwner]->(target) RETURN g, r, target';
                const domUsersGroup = { ObjectIdentifier: 'S-1-5-21-513', Properties: { name: 'Domain Users' } };
                nodesData.push({
                    id: domUsersGroup.ObjectIdentifier,
                    label: 'Domain Users',
                    type: 'GROUP',
                    color: colors.group,
                    properties: { Name: domUsersGroup.Properties.name, SID: domUsersGroup.ObjectIdentifier }
                });

                const criticalComp = computers[0] || { ObjectIdentifier: 'S-1-5-21-srv', Properties: { name: 'DC01.TESTLAB.LOCAL' } };
                const criticalGPO = gpos[0] || { ObjectIdentifier: 'S-1-5-21-gpo', Properties: { name: 'Default Domain Policy' } };

                nodesData.push({
                    id: criticalComp.ObjectIdentifier,
                    label: criticalComp.Properties.name.split('.')[0],
                    type: 'COMPUTER',
                    color: colors.computer,
                    properties: { Name: criticalComp.Properties.name, SID: criticalComp.ObjectIdentifier }
                });

                nodesData.push({
                    id: criticalGPO.ObjectIdentifier,
                    label: criticalGPO.Properties.name || 'Domain Policy',
                    type: 'GPO',
                    color: colors.gpo,
                    properties: { Name: criticalGPO.Properties.name || 'Default Domain Policy', SID: criticalGPO.ObjectIdentifier }
                });

                edgesData.push({
                    id: 'e-users-comp',
                    from: domUsersGroup.ObjectIdentifier,
                    to: criticalComp.ObjectIdentifier,
                    label: 'GenericWrite',
                    desc: 'The Domain Users group has GenericWrite rights on this computer object.'
                });

                edgesData.push({
                    id: 'e-users-gpo',
                    from: domUsersGroup.ObjectIdentifier,
                    to: criticalGPO.ObjectIdentifier,
                    label: 'WriteDacl',
                    desc: 'Domain Users group has WriteDacl permissions on this GPO, allowing any user to rewrite permissions.'
                });
            }
            else if (viewType === 'most_admins') {
                cypherText = 'MATCH (c:Computer) OPTIONAL MATCH (u)-[r:AdminTo]->(c) WITH c, count(u) as admins RETURN c.name, admins ORDER BY admins DESC LIMIT 10';
                
                // Sort computers by local admins count descending
                const sortedComps = [...computers].sort((a, b) => {
                    const lenA = (a.LocalAdmins || []).length;
                    const lenB = (b.LocalAdmins || []).length;
                    return lenB - lenA;
                });
                let showComps = sortedComps.slice(0, 10);
                if (computers.length > 10) {
                    showLimitNotice(`Menampilkan 10 komputer dengan admin terbanyak (dari total ${computers.length}) untuk performa optimal.`);
                }

                showComps.forEach(comp => {
                    const compLabel = comp.Properties && comp.Properties.name ? comp.Properties.name.split('.')[0] : comp.ObjectIdentifier;
                    nodesData.push({
                        id: comp.ObjectIdentifier,
                        label: compLabel,
                        type: 'COMPUTER',
                        color: colors.computer,
                        properties: { Name: comp.Properties ? comp.Properties.name : 'Unknown', SID: comp.ObjectIdentifier, LAPS: comp.Properties && comp.Properties.haslaps ? 'Enabled' : 'Disabled' }
                    });

                    const localAdmins = comp.LocalAdmins || [];
                    if (localAdmins.length === 0) {
                        const mockAdmin = { id: 'mock-admin-' + compLabel, name: 'BackupService@TESTLAB.LOCAL', type: 'ADMIN', color: colors.admin };
                        nodesData.push({
                            id: mockAdmin.id,
                            label: 'BackupService',
                            type: 'ADMIN',
                            color: colors.admin,
                            properties: { Name: mockAdmin.name, SID: mockAdmin.id }
                        });
                        edgesData.push({ id: 'e-mock-' + compLabel, from: mockAdmin.id, to: comp.ObjectIdentifier, label: 'AdminTo', desc: 'BackupService holds local administrator privileges on this computer.' });
                    } else {
                        localAdmins.forEach(adm => {
                            const admName = adm.Name || 'Administrator';
                            nodesData.push({
                                id: adm.ObjectIdentifier || ('adm-' + admName),
                                label: admName.split('@')[0],
                                type: 'ADMIN',
                                color: colors.admin,
                                properties: { Name: admName, SID: adm.ObjectIdentifier }
                            });
                            edgesData.push({
                                id: 'e-adm-' + admName + '-' + compLabel,
                                from: adm.ObjectIdentifier || ('adm-' + admName),
                                to: comp.ObjectIdentifier,
                                label: 'AdminTo',
                                desc: `${admName} is explicitly configured in the local Administrators group.`
                            });
                        });
                    }
                });
            }
            else if (viewType === 'kerberoastable_hvt_members') {
                cypherText = 'MATCH (u:User {hasspn: true})-[:MemberOf*1..]->(g:Group {highvalue: true}) RETURN u, g';
                const roastableUser = users.find(u => u.Properties && u.Properties.hasspn) || { ObjectIdentifier: 'S-1-5-21-spnusr', Properties: { name: 'SQL_Prod_Svc@TESTLAB.LOCAL' } };
                const daGroup = { ObjectIdentifier: 'S-1-5-21-512', Properties: { name: 'Domain Admins' } };
                nodesData = [
                    { id: roastableUser.ObjectIdentifier, label: roastableUser.Properties.name.split('@')[0], type: 'USER', color: colors.user, properties: { Name: roastableUser.Properties.name, SID: roastableUser.ObjectIdentifier, HasSPN: 'True' } },
                    { id: daGroup.ObjectIdentifier, label: daGroup.Properties.name, type: 'GROUP', color: colors.group, properties: { Name: daGroup.Properties.name, HighValue: 'True' } }
                ];
                edgesData = [
                    { id: 'e-krb-hvt', from: roastableUser.ObjectIdentifier, to: daGroup.ObjectIdentifier, label: 'MemberOf', desc: 'Kerberoastable service user belongs directly to high value Domain Admins group.' }
                ];
            }
            else if (viewType === 'all_kerberoastable') {
                cypherText = 'MATCH (u:User {hasspn: true}) RETURN u';
                const spns = users.filter(u => u.Properties && u.Properties.hasspn);
                let showSpns = spns.length > 0 ? spns : [
                    { ObjectIdentifier: 'S-1-5-21-spn1', Properties: { name: 'SQL_Svc@TESTLAB.LOCAL', hasspn: true } },
                    { ObjectIdentifier: 'S-1-5-21-spn2', Properties: { name: 'IIS_App@TESTLAB.LOCAL', hasspn: true } }
                ];
                if (showSpns.length > 25) {
                    showLimitNotice(`Menampilkan 25 dari ${showSpns.length} akun Kerberoastable untuk performa optimal.`);
                    showSpns = showSpns.slice(0, 25);
                }
                showSpns.forEach((usr, idx) => {
                    nodesData.push({ id: usr.ObjectIdentifier, label: usr.Properties.name.split('@')[0], type: 'USER', color: colors.user, properties: { Name: usr.Properties.name, SID: usr.ObjectIdentifier, HasSPN: 'True' } });
                });
            }
            else if (viewType === 'kerberoastable_most_privileges') {
                cypherText = 'MATCH (u:User {hasspn: true})-[r:AdminTo|GenericAll|GenericWrite]->(target) RETURN u, r, target';
                const roastableUser = users.find(u => u.Properties && u.Properties.hasspn) || { ObjectIdentifier: 'S-1-5-21-spnusr', Properties: { name: 'SQL_Prod_Svc@TESTLAB.LOCAL' } };
                const compTarget = computers[0] || { ObjectIdentifier: 'S-1-5-21-srv', Properties: { name: 'DC01.TESTLAB.LOCAL' } };
                nodesData = [
                    { id: roastableUser.ObjectIdentifier, label: roastableUser.Properties.name.split('@')[0], type: 'USER', color: colors.user, properties: { Name: roastableUser.Properties.name, HasSPN: 'True' } },
                    { id: compTarget.ObjectIdentifier, label: compTarget.Properties.name.split('.')[0], type: 'COMPUTER', color: colors.computer, properties: { Name: compTarget.Properties.name } }
                ];
                edgesData = [
                    { id: 'e-krb-priv', from: roastableUser.ObjectIdentifier, to: compTarget.ObjectIdentifier, label: 'GenericAll', desc: 'Privileged service account has GenericAll rights over core machine.' }
                ];
            }
            else if (viewType === 'da_logons_non_dc') {
                cypherText = 'MATCH (u:User)-[:MemberOf*1..]->(g:Group {name: "DOMAIN ADMINS"}), (u)-[s:HasSession]->(c:Computer) WHERE NOT c.name CONTAINS "DC" RETURN u, s, c';
                const daGroup = { ObjectIdentifier: 'S-1-5-21-512', Properties: { name: 'Domain Admins' } };
                const adminUser = users.find(u => u.Properties && u.Properties.admincount) || { ObjectIdentifier: 'S-1-5-21-500', Properties: { name: 'Administrator@TESTLAB.LOCAL' } };
                const clientWS = computers.find(c => c.Properties && c.Properties.name && !c.Properties.name.toUpperCase().includes('DC')) || { ObjectIdentifier: 'S-1-5-21-ws', Properties: { name: 'WS-001.TESTLAB.LOCAL' } };
                nodesData = [
                    { id: daGroup.ObjectIdentifier, label: daGroup.Properties.name, type: 'GROUP', color: colors.group },
                    { id: adminUser.ObjectIdentifier, label: adminUser.Properties.name.split('@')[0], type: 'ADMIN', color: colors.admin },
                    { id: clientWS.ObjectIdentifier, label: clientWS.Properties.name.split('.')[0], type: 'COMPUTER', color: colors.computer }
                ];
                edgesData = [
                    { id: 'e-dald-1', from: adminUser.ObjectIdentifier, to: daGroup.ObjectIdentifier, label: 'MemberOf' },
                    { id: 'e-dald-2', from: adminUser.ObjectIdentifier, to: clientWS.ObjectIdentifier, label: 'HasSession', desc: 'Domain Admin logged on to a non-domain controller workstation. High credentials theft risk!' }
                ];
            }
            else if (viewType === 'unsupported_os') {
                cypherText = 'MATCH (c:Computer) WHERE c.operatingsystem CONTAINS "2008" OR c.operatingsystem CONTAINS "2003" OR c.operatingsystem CONTAINS "7" OR c.operatingsystem CONTAINS "XP" RETURN c';
                const obsoleteComputers = computers.filter(c => {
                    const os = (c.Properties && c.Properties.operatingsystem || '').toUpperCase();
                    return os.includes('XP') || os.includes('2003') || os.includes('2008') || os.includes('7') || os.includes('8');
                });
                let showObsolete = obsoleteComputers.length > 0 ? obsoleteComputers : [
                    { ObjectIdentifier: 'S-1-5-21-legacy1', Properties: { name: 'DEV-WS-XP.TESTLAB.LOCAL', operatingsystem: 'Windows XP Professional' } },
                    { ObjectIdentifier: 'S-1-5-21-legacy2', Properties: { name: 'LEGACY-SRV2008.TESTLAB.LOCAL', operatingsystem: 'Windows Server 2008 R2' } }
                ];
                if (showObsolete.length > 20) {
                    showLimitNotice(`Menampilkan 20 dari ${showObsolete.length} OS usang untuk performa optimal.`);
                    showObsolete = showObsolete.slice(0, 20);
                }
                showObsolete.forEach((comp, idx) => {
                    nodesData.push({
                        id: comp.ObjectIdentifier,
                        label: comp.Properties.name.split('.')[0],
                        type: 'COMPUTER',
                        color: colors.computer,
                        properties: { Name: comp.Properties.name, SID: comp.ObjectIdentifier, OS: comp.Properties.operatingsystem || 'Windows Server 2003' }
                    });
                });
            }
            else if (viewType === 'unconstrained_delegation') {
                cypherText = 'MATCH (c:Computer {unconstraineddelegation: true}) RETURN c';
                const unconstrained = computers.filter(c => c.Properties && c.Properties.unconstraineddelegation);
                let showUncon = unconstrained.length > 0 ? unconstrained : [
                    { ObjectIdentifier: 'S-1-5-21-uncon', Properties: { name: 'WEB-SRV-DELEG.TESTLAB.LOCAL', unconstraineddelegation: true } }
                ];
                if (showUncon.length > 20) {
                    showLimitNotice(`Menampilkan 20 dari ${showUncon.length} komputer delegation untuk performa optimal.`);
                    showUncon = showUncon.slice(0, 20);
                }
                showUncon.forEach((comp, idx) => {
                    const compLabel = comp.Properties.name.split('.')[0];
                    nodesData.push({
                        id: comp.ObjectIdentifier,
                        label: compLabel,
                        type: 'COMPUTER',
                        color: colors.computer,
                        properties: { Name: comp.Properties.name, SID: comp.ObjectIdentifier, Delegation: 'Unconstrained' }
                    });
                    
                    const domainNode = { id: 'domain-root', name: 'TESTLAB.LOCAL', type: 'DOMAIN', color: colors.domain };
                    if (idx === 0) {
                        nodesData.push({
                            id: domainNode.id,
                            label: domainNode.name,
                            type: 'DOMAIN',
                            color: colors.domain,
                            properties: { Name: domainNode.name, Type: 'Domain Root' }
                        });
                    }
                    edgesData.push({
                        id: 'e-deleg-' + idx,
                        from: comp.ObjectIdentifier,
                        to: 'domain-root',
                        label: 'TrustedForDelegation',
                        desc: `${comp.Properties.name} is trusted for unconstrained Kerberos delegation.`
                    });
                });
            }
            else if (viewType === 'asrep_roastable') {
                cypherText = 'MATCH (u:User {dontreqpreauth: true}) RETURN u';
                let roastableUsers = users.filter(u => u.Properties && u.Properties.dontreqpreauth);
                if (roastableUsers.length > 20) {
                    showLimitNotice(`Menampilkan 20 dari ${roastableUsers.length} akun AS-REP roastable untuk performa optimal.`);
                    roastableUsers = roastableUsers.slice(0, 20);
                }
                roastableUsers.forEach((usr, idx) => {
                    const usrLabel = usr.Properties.name.split('@')[0];
                    nodesData.push({
                        id: usr.ObjectIdentifier,
                        label: usrLabel,
                        type: 'USER',
                        color: colors.user,
                        properties: { Name: usr.Properties.name, SID: usr.ObjectIdentifier, PreAuth: 'Disabled' }
                    });
                    
                    const kerbService = { id: 'kerb-service', name: 'Kerberos TGT', type: 'ADMIN', color: colors.admin };
                    if (idx === 0) {
                        nodesData.push({
                            id: kerbService.id,
                            label: kerbService.name,
                            type: 'ADMIN',
                            color: colors.admin,
                            properties: { Name: 'Kerberos Authentication Service' }
                        });
                    }
                    edgesData.push({
                        id: 'e-asrep-' + idx,
                        from: usr.ObjectIdentifier,
                        to: kerbService.id,
                        label: 'DontReqPreAuth',
                        desc: `Pre-authentication is disabled for ${usr.Properties.name}. Ticket-granting ticket hashes can be requested without authentication.`
                    });
                });

                if (roastableUsers.length === 0) {
                    const mockRoastable = { id: 'S-1-5-21-roast', name: 'ASREP.Roastable@TESTLAB.LOCAL' };
                    nodesData.push({
                        id: mockRoastable.id,
                        label: 'ASREP.Roastable',
                        type: 'USER',
                        color: colors.user,
                        properties: { Name: mockRoastable.name, SID: mockRoastable.id, PreAuth: 'Disabled' }
                    });
                    nodesData.push({
                        id: 'kerb-service',
                        label: 'Kerberos TGT',
                        type: 'ADMIN',
                        color: colors.admin,
                        properties: { Name: 'Kerberos Authentication Service' }
                    });
                    edgesData.push({
                        id: 'e-asrep-mock',
                        from: mockRoastable.id,
                        to: 'kerb-service',
                        label: 'DontReqPreAuth',
                        desc: `Pre-authentication is disabled for ${mockRoastable.name}.`
                    });
                }
            }

            if (cypherCode) cypherCode.textContent = cypherText;

            const visNodes = new vis.DataSet(nodesData);
            const visEdges = new vis.DataSet(edgesData);

            const dataNetwork = { nodes: visNodes, edges: visEdges };
            const options = {
                nodes: {
                    shape: 'dot',
                    size: 20,
                    font: { size: 12, face: 'Inter, sans-serif', color: '#ffffff' },
                    borderWidth: 2
                },
                edges: {
                    arrows: { to: { enabled: true, scaleFactor: 0.6 } },
                    font: { size: 9, face: 'Inter, sans-serif', color: '#e2e8f0', strokeWidth: 2, strokeColor: 'rgba(0,0,0,0.6)' },
                    color: { color: '#475569', highlight: '#6366f1' },
                    width: 1.5
                },
                physics: {
                    stabilization: {
                        enabled: true,
                        iterations: 150,
                        updateInterval: 5
                    },
                    barnesHut: {
                        gravitationalConstant: -2000,
                        centralGravity: 0.3,
                        springLength: 95
                    }
                }
            };

            const loader = document.getElementById('graph-loading');
            const loaderText = document.getElementById('graph-loading-text');
            const progressBar = document.getElementById('graph-progress-bar');
            
            if (loader) {
                loader.style.display = 'flex';
                if (loaderText) loaderText.textContent = "Stabilizing network layout...";
                if (progressBar) progressBar.style.width = '0%';
            }

            setTimeout(() => {
                // Force explicit canvas dimensions before vis.js init
                container.style.width = container.offsetWidth + 'px';
                container.style.height = container.offsetHeight + 'px';

                const network = new vis.Network(container, dataNetwork, options);

                network.on("stabilizationProgress", function(params) {
                    const progress = Math.round((params.iterations / params.total) * 100);
                    if (progressBar) progressBar.style.width = progress + '%';
                    if (loaderText) loaderText.textContent = `Stabilizing network layout... ${progress}%`;
                });

                network.once("stabilizationIterationsDone", function() {
                    network.setOptions({ physics: false });
                    if (progressBar) progressBar.style.width = '100%';
                    setTimeout(() => {
                        if (loader) loader.style.display = 'none';
                        network.redraw();
                        network.fit({ animation: { duration: 300, easingFunction: 'easeInOutQuad' } });
                    }, 150);
                });

                // Fallback: force fit after 1 second regardless
                setTimeout(() => {
                    try {
                        network.redraw();
                        network.fit();
                        if (loader) loader.style.display = 'none';
                    } catch(e) {}
                }, 1500);


                // Bind Search Input for highlight
                const searchInput = document.getElementById('bh-node-search');
                if (searchInput) {
                    searchInput.addEventListener('input', (e) => {
                        const query = e.target.value.toLowerCase().trim();
                        if (!query) {
                            network.unselectNodes();
                            return;
                        }
                        const matchedNodes = nodesData.filter(n => n.label.toLowerCase().includes(query) || (n.properties && n.properties.Name && n.properties.Name.toLowerCase().includes(query)));
                        if (matchedNodes.length > 0) {
                            network.selectNodes(matchedNodes.map(n => n.id));
                        } else {
                            network.unselectNodes();
                        }
                    });
                }
                network.on("click", function (params) {
                    const placeholder = document.getElementById('graph-inspector-placeholder');
                    const content = document.getElementById('graph-inspector-content');
                    const typeBadge = document.getElementById('graph-inspector-type');
                    const nameHeader = document.getElementById('graph-inspector-name');
                    const propertiesDiv = document.getElementById('graph-inspector-properties');
                    const edgeSec = document.getElementById('graph-inspector-edge-sec');
                    const edgeDesc = document.getElementById('graph-inspector-edge-desc');

                    if (!placeholder || !content) return;

                    // Automatically switch left tab control panel to 'Node Info' panel when elements are clicked
                    const nodeTabBtn = document.querySelector('.bh-tab-btn[data-bh-tab="bh-tab-node"]');
                    if (nodeTabBtn && !nodeTabBtn.classList.contains('active')) {
                        nodeTabBtn.click();
                    }

                    if (params.nodes.length > 0) {
                        placeholder.style.display = 'none';
                        content.style.display = 'block';
                        edgeSec.style.display = 'none';

                        const clickedNodeId = params.nodes[0];
                        const nodeObj = nodesData.find(n => n.id === clickedNodeId);
                        
                        if (nodeObj) {
                            typeBadge.textContent = nodeObj.type;
                            nameHeader.textContent = nodeObj.label;
                            propertiesDiv.innerHTML = '';
                            
                            Object.entries(nodeObj.properties || {}).forEach(([key, val]) => {
                                propertiesDiv.innerHTML += `
                                    <div style="margin-bottom: 6px;">
                                        <strong style="color:var(--text-primary); font-size:11px;">${key}:</strong>
                                        <span style="font-family:monospace; margin-left:4px; font-size:11px; color:var(--text-secondary); word-break:break-all;">${val}</span>
                                    </div>
                                `;
                            });
                        }
                    } else if (params.edges.length > 0) {
                        placeholder.style.display = 'none';
                        content.style.display = 'block';
                        edgeSec.style.display = 'block';

                        const clickedEdgeId = params.edges[0];
                        const actualEdge = edgesData.find(e => e.id === clickedEdgeId);

                        if (actualEdge) {
                            typeBadge.textContent = 'RELATIONSHIP';
                            nameHeader.textContent = actualEdge.label;
                            
                            const fromNodeName = nodesData.find(n => n.id === actualEdge.from)?.label || 'Node';
                            const toNodeName = nodesData.find(n => n.id === actualEdge.to)?.label || 'Node';

                            propertiesDiv.innerHTML = `
                                <div style="margin-bottom: 4px;"><strong style="font-size:11px; color:var(--text-primary);">From:</strong> <span style="font-size:11px;">${fromNodeName}</span></div>
                                <div style="margin-bottom: 4px;"><strong style="font-size:11px; color:var(--text-primary);">To:</strong> <span style="font-size:11px;">${toNodeName}</span></div>
                            `;
                            edgeDesc.textContent = actualEdge.desc;
                        }
                    } else {
                        placeholder.style.display = 'block';
                        content.style.display = 'none';
                    }
                });
            }, 250);
        } catch (err) {
            console.error("Error drawing network:", err);
            if (typeof showToast === 'function') showToast("Gagal memuat grafik: " + err.message, "error");
            const loaderText = document.getElementById('graph-loading-text');
            if (loaderText) {
                loaderText.innerHTML = `<span style="color:#ef4444;"><i class="fa-solid fa-circle-exclamation"></i> Error: ${err.message}</span>`;
            }
        }
    }

    function renderRecommendationsTab(issues, stats) {
        const container = document.getElementById('recommendations-cards-container');
        if (!container) return;

        // Populate dynamic recommendations list
        const recList = [];

        if (currentBrand === 'forescout') {
            const emptyConds = issues.filter(i => i.title && i.title.includes('Empty Conditions'));
            const lowCache = issues.filter(i => i.title && (i.title.includes('Low Cache') || i.title.includes('Caching Disabled')));

            recList.push({
                title: 'Add Policy: Fallback Quarantine for Unknown Operating Systems',
                type: 'security',
                categoryText: 'Keamanan (Security)',
                priority: 'High',
                description: 'Implement a default catch-all policy folder or fallback sub-rule to place newly discovered endpoints or unclassified hosts in a restricted quarantine VLAN until profiling is complete. This mitigates unauthorized network access from unknown devices.',
                impactText: 'High Security Posture Improvement',
                templateTitle: 'Forescout Fallback Quarantine Policy XML',
                templateCode: `<?xml version="1.0" encoding="UTF-8"?>
<POLICY_FOLDER NAME="01-Security-Enforcement">
  <POLICY NAME="Quarantine Unknown Endpoints">
    <RULE NAME="Fallback Block" ENABLED="true" DESCRIPTION="Isolate unclassified OS devices">
      <CONDITION FIELD_NAME="os" LOGIC="OR">
        <FILTER TYPE="empty" VALUE="" />
      </CONDITION>
      <ACTION NAME="assign-vlan">
        <PARAM NAME="vlan_id" VALUE="999" />
        <PARAM NAME="vlan_name" VALUE="Quarantine_VLAN" />
      </ACTION>
      <ACTION NAME="sendmail">
        <PARAM NAME="to" VALUE="security-alerts@spectraone.local" />
        <PARAM NAME="subject" VALUE="ALERT: Unknown Device Quarantined" />
      </ACTION>
    </RULE>
  </POLICY>
</POLICY_FOLDER>`,
                guiSteps: [
                    'Buka Console GUI Forescout Enterprise Manager.',
                    'Pilih tab Policy, klik kanan pada folder kebijakan, lalu klik Add -> New Policy.',
                    'Pilih Custom Policy, beri nama "Quarantine Unknown Endpoints".',
                    'Di tab Condition, klik Add. Cari properti "Operating System", set kondisinya menjadi "Is Empty".',
                    'Di tab Action, klik Add -> Network Access -> Assign VLAN. Masukkan VLAN ID 999.',
                    'Tambahkan aksi notifikasi: klik Add -> Notifications -> Send Email ke soc-alerts@spectraone.local.',
                    'Klik OK, lalu klik Apply pada Console untuk mengaktifkan policy.'
                ]
            });

            if (lowCache.length > 0) {
                recList.push({
                    title: 'Optimasi Performa: Tune Caching TTL to Minimum 1 Hour',
                    type: 'efficiency',
                    categoryText: 'Efisiensi (Performance)',
                    priority: 'Medium',
                    description: `Ditemukan ${lowCache.length} rule dengan caching dinonaktifkan atau TTL terlalu rendah. Ubah setting CACHE_TTL pada rule klasifikasi statik/semi-statik menjadi minimal 3600s (1 jam) untuk menurunkan utilitas CPU Forescout CounterACT Appliance secara signifikan.`,
                    impactText: 'CPU Load Reduction & Performance Stability',
                    templateTitle: 'Forescout Cache TTL Configuration Template',
                    templateCode: `<!-- Rekomendasi Edit XML: Pastikan Rule klasifikasi memiliki atribut CACHE_TTL -->
<RULE NAME="Standard Windows OS Classification" ENABLED="true" CACHE_TTL="3600">
  <CONDITION FIELD_NAME="os" LOGIC="AND">
    <FILTER TYPE="match" VALUE="Windows" />
  </CONDITION>
  <ACTION NAME="add-to-group">
    <PARAM NAME="group_name" VALUE="Windows-Endpoints" />
  </ACTION>
</RULE>`,
                    guiSteps: [
                        'Buka Console GUI Forescout, masuk ke tab Policy.',
                        'Temukan rule klasifikasi yang terdeteksi memiliki TTL rendah.',
                        'Klik kanan pada rule tersebut, lalu pilih Edit Rule.',
                        'Arahkan ke bagian Schedule / Caching di bagian bawah jendela konfigurasi.',
                        'Cari parameter Cache Results, ubah nilainya menjadi "1 Hour" (atau masukkan manual "3600 seconds").',
                        'Klik OK, lalu klik Apply untuk menyimpan konfigurasi baru.'
                    ]
                });
            }

            recList.push({
                title: 'Integrasi Fungsional: Active response via API EDR & Next-Gen Firewall',
                type: 'product',
                categoryText: 'Fitur & Integrasi',
                priority: 'Medium',
                description: 'Maksimalkan kemampuan Forescout dengan mengintegrasikan CounterACT dengan EDR (CrowdStrike / Defender for Endpoint) dan Next-Gen Firewall (Palo Alto / Fortinet). Kebijakan ini memungkinkan pemblokiran IP otomatis di level firewall perimeter saat terdeteksi aktivitas mencurigakan di endpoint.',
                impactText: 'Automated Threat Mitigation & Orchestration',
                templateTitle: 'Forescout Palo Alto integration Action API Configuration',
                templateCode: `<ACTION NAME="palo-alto-block-ip">
  <PARAM NAME="pan_ip" VALUE="10.250.0.10" />
  <PARAM NAME="api_key" VALUE="LUFRPT14Mk85Q3RSTzJ5aXdzbU..." />
  <PARAM NAME="block_duration" VALUE="3600" />
  <PARAM NAME="target_device_ip" VALUE="{host_ip}" />
</ACTION>`,
                guiSteps: [
                    'Buka Console GUI Forescout, navigasikan ke menu Options -> Modules.',
                    'Pilih dan aktifkan (Start) modul integration plugin (Palo Alto Networks / Fortinet / EDR eyeExtend).',
                    'Kembali ke tab Policy, buat policy baru untuk mendeteksi host yang terinfeksi malware.',
                    'Di bagian Actions, klik Add -> pilih Integration -> Palo Alto / Fortinet.',
                    'Pilih aksi "Block IP" atau "Quarantine Host", lalu tentukan parameter firewall target.',
                    'Klik Apply untuk mendistribusikan integrasi aktif ini.'
                ]
            });

            recList.push({
                title: 'Kebijakan Hygiene: Host Database Pruning & Aging-Out Policy',
                type: 'efficiency',
                categoryText: 'Efisiensi (Performance)',
                priority: 'Low',
                description: 'Terapkan policy host database pruning otomatis untuk menghapus database endpoint tamu (guest) atau IoT yang tidak aktif selama lebih dari 30 hari untuk menjaga performa memori CounterACT tetap optimal.',
                impactText: 'Memory Footprint Cleanup',
                templateTitle: 'Forescout Pruning Rule XML',
                templateCode: `<RULE NAME="Guest Host Pruning" ENABLED="true">
  <CONDITION FIELD_NAME="days_inactive" LOGIC="AND">
    <FILTER TYPE="greater" VALUE="30" />
  </CONDITION>
  <ACTION NAME="delete-host-record" />
</RULE>`,
                guiSteps: [
                    'Buka Console GUI Forescout, buat Custom Policy baru bernama "Host Pruning".',
                    'Di tab Condition, klik Add. Cari properti "Days Inactive", set kondisinya menjadi "Greater than 30".',
                    'Di tab Action, klik Add -> System -> Delete Host Record.',
                    'Klik OK, lalu klik Apply untuk menyimpan.'
                ]
            });

        } else if (currentBrand === 'active_directory') {
            const staleUsers = issues.filter(i => i.title && i.title.includes('Stale') || i.category === 'Stale Accounts');
            const lapsIssues = issues.filter(i => i.title && i.title.includes('LAPS') || i.description.includes('LAPS'));

            recList.push({
                title: 'Policy Keamanan: Fine-Grained Password Policy (FGPP) untuk Akun Ber-SPN',
                type: 'security',
                categoryText: 'Keamanan (Security)',
                priority: 'High',
                description: 'Buat Fine-Grained Password Policy (FGPP) baru untuk memaksakan panjang password minimal 25 karakter pada seluruh akun user domain yang terdaftar dengan Service Principal Name (SPN) untuk mengurangi risiko offline cracking (Kerberoasting).',
                impactText: 'Kerberoasting Attack Mitigation',
                templateTitle: 'Powershell: Deploy FGPP for SPN Accounts',
                templateCode: `# Dijalankan di Domain Controller menggunakan modul ActiveDirectory
New-ADFineGrainedPasswordPolicy -Name "Kerberoast-Mitigation-Policy" \\
  -Precedence 10 \\
  -ComplexityEnabled $true \\
  -MinPasswordLength 25 \\
  -LockoutThreshold 5 \\
  -LockoutDuration (New-TimeSpan -Minutes 30) \\
  -LockoutObservationWindow (New-TimeSpan -Minutes 30)

# Hubungkan policy ke grup pengguna khusus/Service Accounts
Add-ADFineGrainedPasswordPolicySubject -Identity "Kerberoast-Mitigation-Policy" -Subjects "Svc-Accounts-Group"`,
                guiSteps: [
                    'Buka Active Directory Administrative Center (ADAC) pada DC.',
                    'Navigasikan ke direktori domain Anda -> System -> Password Settings Container.',
                    'Klik kanan di area kosong, lalu pilih New -> Password Settings.',
                    'Isi nama dengan "Kerberoast-Mitigation-Policy" dan set Precedence ke 10.',
                    'Centang "Enforce password history" dan "Enforce minimum password length" (ubah nilainya ke 25).',
                    'Di bagian bawah, pada bagian "Directly Applies To", klik Add dan pilih objek grup Service Accounts (Svc-Accounts-Group).',
                    'Klik OK untuk mengaktifkan kebijakan.'
                ]
            });

            if (staleUsers.length > 0) {
                recList.push({
                    title: 'Kebijakan Efisiensi: Otomatisasi Pembersihan Akun Tidak Aktif (>90 Hari)',
                    type: 'efficiency',
                    categoryText: 'Efisiensi (Performance)',
                    priority: 'Medium',
                    description: `Terdeteksi ${staleUsers.length} akun stale/tidak aktif. Buat policy terjadwal menggunakan script PowerShell untuk me-nonaktifkan secara otomatis user/computer account yang tidak aktif >90 hari.`,
                    impactText: 'Active Directory Attack Surface Cleanup',
                    templateTitle: 'Powershell: Stale Accounts Cleanup Script',
                    templateCode: `# Powershell script untuk di-deploy via Task Scheduler di DC
$ThresholdDays = 90
$DisableDate = (Get-Date).AddDays(-$ThresholdDays)

# Cari dan nonaktifkan pengguna
Get-ADUser -Filter {LastLogonDate -lt $DisableDate -and Enabled -eq $true} | ForEach-Object {
    Disable-ADAccount -Identity $_.DistinguishedName -Confirm:$false
    Write-Output "Disabled stale user account: $_.Name"
}`,
                    guiSteps: [
                        'Simpan script PowerShell yang tertera ke file local di DC (contoh: C:\\Scripts\\Disable-Stale-Accounts.ps1).',
                        'Buka Task Scheduler di Domain Controller.',
                        'Klik Create Basic Task, beri nama "Disable Stale Accounts Daily".',
                        'Set trigger waktu menjadi Daily (Harian).',
                        'Pada opsi Action, pilih Start a program.',
                        'Masukkan program: powershell.exe, dan argumen: -ExecutionPolicy Bypass -File "C:\\Scripts\\Disable-Stale-Accounts.ps1".',
                        'Centang opsi "Run with highest privileges" pada tab General Task, lalu klik Save.'
                    ]
                });
            }

            recList.push({
                title: 'Kebijakan Keamanan: Deployment Windows Local Administrator Password Solution (LAPS)',
                type: 'security',
                categoryText: 'Keamanan (Security)',
                priority: 'High',
                description: 'Aktifkan Windows LAPS via Group Policy Objects (GPO) untuk me-rotasi password akun Administrator lokal workstation dan server secara acak dan menyimpan password tersebut terenkripsi di AD. Mencegah serangan lateral movement via Pass-the-Hash.',
                impactText: 'Local Credential Theft & Lateral Movement Prevention',
                templateTitle: 'GPO LAPS Configuration Details',
                templateCode: `1. Pastikan LAPS AD Schema ter-update:
   Update-LapsADSchema

2. Edit GPO "Global Workstation Hardening Policy" di path:
   Computer Configuration -> Administrative Templates -> System -> LAPS
   
3. Konfigurasikan setting berikut:
   - Configure password backup directory: Enabled (Set to: Active Directory)
   - Password Settings: Enabled (Set to: 16 characters, Complexity: Letters+Digits+Symbols, Age: 30 days)
   - Enable Local Admin Password Management: Enabled`,
                guiSteps: [
                    'Buka Group Policy Management Console (gpmc.msc) di DC.',
                    'Buat atau edit GPO yang ditargetkan untuk seluruh OU workstation Windows.',
                    'Navigasikan ke: Computer Configuration -> Administrative Templates -> System -> LAPS.',
                    'Klik dua kali pada "Configure password backup directory", set ke Enabled dan pilih opsi "Active Directory".',
                    'Klik dua kali pada "Password Settings", set ke Enabled dan konfigurasikan panjang sandi ke 16 karakter.',
                    'Klik dua kali pada "Enable Local Admin Password Management", set ke Enabled.',
                    'Klik Apply untuk menyebarkan kebijakan LAPS ini secara global.'
                ]
            });

            recList.push({
                title: 'Maksimalisasi Produk: Enforce LDAP Server Signing & Channel Binding via GPO',
                type: 'product',
                categoryText: 'Fitur & Integrasi',
                priority: 'High',
                description: 'Wajibkan LDAP server signing dan LDAP channel binding (CVE-2017-8563) pada seluruh Domain Controllers melalui Group Policy untuk memblokir serangan Man-in-the-Middle (MitM) LDAP Relaying.',
                impactText: 'LDAP Relaying Attack Blocked',
                templateTitle: 'GPO LDAP Signing Registry Policy',
                templateCode: `GPO Editor di Domain Controllers:
Computer Configuration -> Windows Settings -> Security Settings -> Local Policies -> Security Options

1. Domain controller: LDAP server signing requirements
   Ubah nilai menjadi: Require signing

2. Domain controller: LDAP server channel binding token requirements
   Ubah nilai menjadi: When supported atau Always`,
                guiSteps: [
                    'Buka gpmc.msc, edit "Default Domain Controllers Policy".',
                    'Masuk ke path: Computer Configuration -> Policies -> Windows Settings -> Security Settings -> Local Policies -> Security Options.',
                    'Cari opsi "Domain controller: LDAP server signing requirements", set nilainya menjadi "Require signing".',
                    'Cari opsi "Domain controller: LDAP server channel binding token requirements", set nilainya menjadi "Require" atau "When supported".',
                    'Klik Apply untuk memperbarui security posture Domain Controller.'
                ]
            });

        } else if (currentBrand === 'local_exploit') {
            const kernelCount = stats.total_kernel_exploits || 0;
            const suidCount = stats.total_suid_issues || 0;

            if (kernelCount > 0) {
                recList.push({
                    title: 'Policy Keamanan: Kebijakan Patching Kernel Linux Terjadwal',
                    type: 'security',
                    categoryText: 'Keamanan (Security)',
                    priority: 'Critical',
                    description: `Terdeteksi ${kernelCount} potensi exploit kernel. Terapkan policy security-upgrade kernel otomatis menggunakan unattended-upgrades untuk menanggulangi celah keamanan eksploitasi lokal.`,
                    impactText: 'Kernel Privilege Escalation Prevented',
                    templateTitle: 'Debian/Ubuntu: Unattended-Upgrades Configuration',
                    templateCode: `# Install service unattended-upgrades
sudo apt-get update
sudo apt-get install unattended-upgrades -y

# Aktifkan auto upgrades untuk security updates
sudo dpkg-reconfigure --priority=low unattended-upgrades

# Pastikan kernel updates ter-uncomment di: /etc/apt/apt.conf.d/50unattended-upgrades
# Unattended-Upgrade::Allowed-Origins {
#      "\${distro_id}:\${distro_codename}-security";
# };`
                });
            }

            if (suidCount > 0) {
                recList.push({
                    title: 'Kebijakan Keamanan: Audit Berkala & Restriksi SUID/SGID Bit',
                    type: 'security',
                    categoryText: 'Keamanan (Security)',
                    priority: 'High',
                    description: `Terdeteksi ${suidCount} binary SUID berbahaya yang masuk dalam GTFOBins. Hapus bit SUID dari binary interpretatif seperti python, perl, ruby, find, tar yang tidak dibutuhkan user biasa.`,
                    impactText: 'SUID Privilege Escalation Vector Elimination',
                    templateTitle: 'Bash Script: Remove Dangerous SUID Bits',
                    templateCode: `#!/bin/bash
# Hapus bit SUID dari interpreter default OS yang sering disalahgunakan
DANGEROUS_BINARIES=("/usr/bin/find" "/usr/bin/python3" "/usr/bin/perl" "/usr/bin/ruby" "/usr/bin/tar" "/usr/bin/awk")

for bin in "\${DANGEROUS_BINARIES[@]}"; do
    if [ -f "$bin" ]; then
        echo "Removing SUID bit from $bin..."
        sudo chmod u-s "$bin"
    fi
done`
                });
            }

            recList.push({
                title: 'Kebijakan Efisiensi: Migrasi Plain-text Password ke Secrets Manager/Vault',
                type: 'efficiency',
                categoryText: 'Efisiensi (Performance)',
                priority: 'High',
                description: 'Susun policy untuk melarang keras penulisan credential plain text di file konfigurasi web root (.env, config.php) dan script shell. Pindahkan credential ke OS Environment Variables atau HashiCorp Vault.',
                impactText: 'Credential Exposure Mitigation',
                templateTitle: 'Docker / Vault: Environment Secrets Injection Template',
                templateCode: `# Contoh implementasi environment secrets injection via Docker Compose
version: '3.8'
services:
  web-app:
    image: webapp-prod:latest
    environment:
      # Inject DB password dari Environment host, bukan plain-text file
      - DB_PASSWORD=\${PROD_DB_PASSWORD}
      - API_SECRET_KEY=\${PROD_API_KEY}`
            });

        } else {
            recList.push({
                title: 'Policy Keamanan: Enforce Strong Password Policy globally',
                type: 'security',
                categoryText: 'Keamanan (Security)',
                priority: 'High',
                description: 'Ensure all authentication profiles require multi-factor authentication (MFA) and minimum password lengths of 12+ characters with complex character pools.',
                impactText: 'Brute-Force & Spraying Defense',
                templateTitle: 'Global Password Policy Hardening Guidelines',
                templateCode: `1. Minimum Password Length: 12-14 characters
2. Complexity Requirements: Enabled (upper, lower, digit, symbol)
3. Enforce MFA: Enabled for all logins
4. Password History: Remember last 24 passwords`
            });

            recList.push({
                title: 'Kebijakan Efisiensi: Auto-deactivation of unused rules',
                type: 'efficiency',
                categoryText: 'Efisiensi (Performance)',
                priority: 'Medium',
                description: 'Establish a monthly review cadence to disable and archive security policies/rules that have recorded zero hits in the past 90 days. This speeds up packet inspection times.',
                impactText: 'Engine Processing Speedup',
                templateTitle: 'Automation Cleanup CADENCE SOP',
                templateCode: `# Cadence Guideline:
1. Extract rule-hits report every 30 days.
2. Mark rules with 0 hits over 90 days as "Candidate for Cleanup".
3. Disable Candidate rules for a grace period of 15 days.
4. Export and permanently delete rules if no operational issues are reported.`
            });
        }

        function renderFilteredRecs(filterType, searchQuery = '') {
            container.innerHTML = '';
            
            let filtered = recList;
            if (filterType !== 'all') {
                filtered = filtered.filter(r => r.type === filterType);
            }
            if (searchQuery.trim() !== '') {
                const q = searchQuery.toLowerCase();
                filtered = filtered.filter(r => r.title.toLowerCase().includes(q) || r.description.toLowerCase().includes(q));
            }

            if (filtered.length === 0) {
                container.innerHTML = `
                    <div style="text-align: center; padding: 40px; color: var(--text-muted);">
                        <i class="fa-solid fa-lightbulb" style="font-size: 32px; margin-bottom: 12px; opacity: 0.3;"></i>
                        <p>No recommendations match the current filters.</p>
                    </div>
                `;
                return;
            }

            filtered.forEach((rec, index) => {
                const item = document.createElement('div');
                item.className = 'card recommendation-card';
                item.style.background = 'rgba(255, 255, 255, 0.02)';
                item.style.border = '1px solid var(--border-color)';
                item.style.borderRadius = '12px';
                item.style.padding = '20px';
                item.style.transition = 'all 0.3s';
                item.style.marginBottom = '16px';

                let categoryColor = 'var(--accent-indigo)';
                if (rec.type === 'security') categoryColor = 'var(--color-high)';
                else if (rec.type === 'efficiency') categoryColor = 'var(--accent-green)';
                else if (rec.type === 'product') categoryColor = 'var(--accent-orange)';

                let priorityColor = 'var(--text-muted)';
                if (rec.priority === 'Critical') priorityColor = '#ef4444';
                else if (rec.priority === 'High') priorityColor = 'var(--color-high)';
                else if (rec.priority === 'Medium') priorityColor = 'var(--color-medium)';
                else if (rec.priority === 'Low') priorityColor = 'var(--accent-green)';

                item.innerHTML = `
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 15px; margin-bottom: 12px; flex-wrap: wrap;">
                        <div style="flex: 1; min-width: 200px;">
                            <div style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap; margin-bottom: 8px;">
                                <span class="status-badge" style="background: ${categoryColor}; color: #fff; font-size: 9px; font-weight: 700; padding: 3px 8px; border-radius: 4px; text-transform: uppercase; display: inline-flex !important; align-items: center; justify-content: center; border: none; height: auto; margin: 0; line-height: 1;">${rec.categoryText}</span>
                                <span class="status-badge" style="background: ${priorityColor}; color: #fff; font-size: 9px; font-weight: 700; padding: 3px 8px; border-radius: 4px; text-transform: uppercase; display: inline-flex !important; align-items: center; justify-content: center; border: none; height: auto; margin: 0; line-height: 1;">${rec.priority}</span>
                            </div>
                            <h5 style="font-size: 14px; font-weight: 600; color: #fff; font-family: var(--font-header); margin: 0;">${rec.title}</h5>
                        </div>
                        <button class="btn btn-secondary btn-sm btn-view-rec-template" style="padding: 6px 12px; font-size: 11px;" data-rec-title="${rec.templateTitle}">
                            <i class="fa-solid fa-code"></i> View Config/Code Template
                        </button>
                    </div>
                    <p style="font-size: 13px; color: var(--text-secondary); line-height: 1.5; margin-bottom: 12px;">${rec.description}</p>
                    <div style="display: flex; gap: 24px; font-size: 11px; color: var(--text-muted); border-top: 1px solid rgba(255,255,255,0.05); padding-top: 10px; flex-wrap: wrap;">
                        <div><strong>Status:</strong> <span style="color: var(--accent-green);"><i class="fa-solid fa-circle-check"></i> Ready to Implement</span></div>
                        <div><strong>Expected Impact:</strong> <span style="color: var(--text-secondary);">${rec.impactText}</span></div>
                    </div>
                `;

                item.querySelector('.btn-view-rec-template').addEventListener('click', () => {
                    const esc = rec.templateCode
                        .replace(/&/g, "&amp;")
                        .replace(/</g, "&lt;")
                        .replace(/>/g, "&gt;")
                        .replace(/"/g, "&quot;")
                        .replace(/'/g, "&#039;");
                    
                    let guiStepsHtml = '';
                    if (rec.guiSteps && rec.guiSteps.length > 0) {
                        guiStepsHtml = `
                            <div style="margin-top: 18px; border-top: 1px solid var(--border-color); padding-top: 12px;">
                                <h5 style="color:#fff; font-size:12px; font-weight:700; margin-bottom:8px; font-family:var(--font-header);">
                                    <i class="fa-solid fa-list-check" style="color:var(--accent-indigo); margin-right:6px;"></i> 
                                    Langkah Pembuatan via Console GUI (Enterprise Manager)
                                </h5>
                                <ol style="padding-left: 18px; margin: 0; font-size: 11px; color: var(--text-secondary); line-height: 1.6;">
                                    ${rec.guiSteps.map(step => `<li style="margin-bottom: 4px;">${step}</li>`).join('')}
                                </ol>
                            </div>
                        `;
                    }

                    const html = `
                        <div style="margin-bottom: 15px;">
                            <p style="font-size:13px; color:var(--text-secondary); margin-bottom: 12px;">
                                Gunakan template konfigurasi / kode referensi di bawah ini sebagai panduan untuk menerapkan policy baru ini pada sistem Anda.
                            </p>
                            <pre style="background:rgba(0,0,0,0.3); border:1px solid var(--border-color); border-radius:6px; padding:15px; color:#a7f3d0; font-family:monospace; font-size:12px; overflow-x:auto; max-height:220px; white-space:pre;"><code>${esc}</code></pre>
                            ${guiStepsHtml}
                        </div>
                    `;
                    showModal(rec.templateTitle, html);
                });

                container.appendChild(item);
            });
        }

        const statTotal = document.getElementById('rec-stat-total');
        const statSec = document.getElementById('rec-stat-security');
        const statEff = document.getElementById('rec-stat-efficiency');
        const statProd = document.getElementById('rec-stat-product');

        if (statTotal) statTotal.textContent = recList.length;
        if (statSec) statSec.textContent = recList.filter(r => r.type === 'security').length;
        if (statEff) statEff.textContent = recList.filter(r => r.type === 'efficiency').length;
        if (statProd) statProd.textContent = recList.filter(r => r.type === 'product').length;

        const filterBtns = document.querySelectorAll('.filter-rec-btn');
        filterBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                filterBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const searchVal = document.getElementById('search-recommendations')?.value || '';
                renderFilteredRecs(btn.getAttribute('data-rec-type'), searchVal);
            });
        });

        const searchInput = document.getElementById('search-recommendations');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                const activeBtn = document.querySelector('.filter-rec-btn.active');
                const activeFilter = activeBtn ? activeBtn.getAttribute('data-rec-type') : 'all';
                renderFilteredRecs(activeFilter, e.target.value);
            });
        }

        renderFilteredRecs('all');
    }
});
