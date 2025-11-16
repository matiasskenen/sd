// monitoring.js - Panel de Monitoreo y Debugging

const API_BASE = window.BACKEND_URL || 'http://localhost:3000';

// Estado global
let autoRefreshInterval = null;
let currentTab = 'logs';

// Inicialización
document.addEventListener('DOMContentLoaded', () => {
    initTabs();
    initHealthCheck();
    initLogsTab();
    initMetricsTab();
    initTestingTab();
    initConfigTab();
    
    // Cargar datos iniciales
    loadLogs();
    loadMetrics();
    
    console.log('✅ Panel de Monitoreo iniciado');
});

// ===== TABS =====
function initTabs() {
    const tabButtons = document.querySelectorAll('.tab-btn');
    
    tabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const tabName = btn.dataset.tab;
            switchTab(tabName);
        });
    });
}

function switchTab(tabName) {
    currentTab = tabName;
    
    // Actualizar botones
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabName);
    });
    
    // Actualizar contenido
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.toggle('active', content.id === `tab-${tabName}`);
    });
    
    // Cargar datos según tab
    if (tabName === 'logs') {
        loadLogs();
    } else if (tabName === 'metrics') {
        loadMetrics();
    }
}

// ===== HEALTH CHECK =====
function initHealthCheck() {
    checkHealth();
    setInterval(checkHealth, 30000); // Cada 30s
}

async function checkHealth() {
    try {
        const res = await fetch(`${API_BASE}/api/monitoring/health`);
        const data = await res.json();
        
        const badge = document.getElementById('healthBadge');
        
        if (data.status === 'healthy') {
            badge.className = 'px-3 py-1 rounded-full text-xs font-semibold bg-green-500 text-white';
            badge.innerHTML = '<i class="fas fa-circle"></i> Healthy';
        } else if (data.status === 'degraded') {
            badge.className = 'px-3 py-1 rounded-full text-xs font-semibold bg-yellow-500 text-white';
            badge.innerHTML = '<i class="fas fa-circle"></i> Degraded';
        } else {
            badge.className = 'px-3 py-1 rounded-full text-xs font-semibold bg-red-500 text-white';
            badge.innerHTML = '<i class="fas fa-circle"></i> Unhealthy';
        }
    } catch (err) {
        const badge = document.getElementById('healthBadge');
        badge.className = 'px-3 py-1 rounded-full text-xs font-semibold bg-gray-500 text-white';
        badge.innerHTML = '<i class="fas fa-circle"></i> Error';
    }
}

// ===== TAB: LOGS =====
function initLogsTab() {
    // Filtros
    document.getElementById('logLevelFilter').addEventListener('change', loadLogs);
    document.getElementById('logLimit').addEventListener('change', loadLogs);
    
    // Auto-refresh
    const autoRefreshCheckbox = document.getElementById('autoRefresh');
    autoRefreshCheckbox.addEventListener('change', (e) => {
        if (e.target.checked) {
            startAutoRefresh();
        } else {
            stopAutoRefresh();
        }
    });
    
    // Botones
    document.getElementById('refreshLogsBtn').addEventListener('click', loadLogs);
    document.getElementById('clearLogsBtn').addEventListener('click', clearLogs);
    document.getElementById('downloadLogsBtn').addEventListener('click', downloadLogs);
    
    // Iniciar auto-refresh
    startAutoRefresh();
}

function startAutoRefresh() {
    if (autoRefreshInterval) return;
    
    autoRefreshInterval = setInterval(() => {
        if (currentTab === 'logs') {
            loadLogs();
        }
    }, 5000);
}

function stopAutoRefresh() {
    if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
        autoRefreshInterval = null;
    }
}

async function loadLogs() {
    const level = document.getElementById('logLevelFilter').value;
    const limit = document.getElementById('logLimit').value;
    
    try {
        const res = await fetch(`${API_BASE}/api/monitoring/logs?level=${level}&limit=${limit}`);
        const data = await res.json();
        
        displayLogs(data.logs);
        updateLogStats(data.logs);
        
        document.getElementById('lastUpdate').textContent = `Última actualización: ${new Date().toLocaleTimeString()}`;
    } catch (err) {
        console.error('Error cargando logs:', err);
        showError('logsConsole', 'Error al cargar logs');
    }
}

function displayLogs(logs) {
    const console = document.getElementById('logsConsole');
    
    if (logs.length === 0) {
        console.innerHTML = '<p class="text-gray-500 text-center py-8">No hay logs para mostrar</p>';
        return;
    }
    
    const html = logs.map(log => {
        const levelClass = {
            'DEBUG': 'log-debug',
            'INFO': 'log-info',
            'WARN': 'log-warn',
            'ERROR': 'log-error'
        }[log.level] || 'log-info';
        
        const icon = {
            'DEBUG': 'fa-bug',
            'INFO': 'fa-info-circle',
            'WARN': 'fa-exclamation-triangle',
            'ERROR': 'fa-times-circle'
        }[log.level] || 'fa-info-circle';
        
        const timestamp = new Date(log.timestamp).toLocaleTimeString();
        const metadata = log.metadata && Object.keys(log.metadata).length > 0
            ? `<div class="log-metadata">${JSON.stringify(log.metadata, null, 2)}</div>`
            : '';
        
        return `
            <div class="log-entry ${levelClass}">
                <div class="log-header">
                    <span class="log-time">${timestamp}</span>
                    <span class="log-level">
                        <i class="fas ${icon}"></i> ${log.level}
                    </span>
                </div>
                <div class="log-message">${escapeHtml(log.message)}</div>
                ${metadata}
            </div>
        `;
    }).join('');
    
    console.innerHTML = html;
    
    // Auto-scroll al final
    console.scrollTop = console.scrollHeight;
}

function updateLogStats(logs) {
    const stats = {
        DEBUG: 0,
        INFO: 0,
        WARN: 0,
        ERROR: 0
    };
    
    logs.forEach(log => {
        stats[log.level] = (stats[log.level] || 0) + 1;
    });
    
    document.getElementById('logCountTotal').textContent = logs.length;
    document.getElementById('logCountError').textContent = stats.ERROR;
    document.getElementById('logCountWarn').textContent = stats.WARN;
    document.getElementById('logCountInfo').textContent = stats.INFO;
}

async function clearLogs() {
    if (!confirm('¿Estás seguro de que quieres limpiar todos los logs?')) return;
    
    try {
        await fetch(`${API_BASE}/api/monitoring/logs`, { method: 'DELETE' });
        loadLogs();
        showSuccess('Logs limpiados exitosamente');
    } catch (err) {
        showError('logsConsole', 'Error al limpiar logs');
    }
}

async function downloadLogs() {
    const level = document.getElementById('logLevelFilter').value;
    const limit = document.getElementById('logLimit').value;
    
    try {
        const res = await fetch(`${API_BASE}/api/monitoring/logs?level=${level}&limit=${limit}`);
        const data = await res.json();
        
        const blob = new Blob([JSON.stringify(data.logs, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `logs-${new Date().toISOString()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        
        showSuccess('Logs descargados exitosamente');
    } catch (err) {
        showError('logsConsole', 'Error al descargar logs');
    }
}

// ===== TAB: MÉTRICAS =====
function initMetricsTab() {
    document.getElementById('refreshMetricsBtn').addEventListener('click', loadMetrics);
    document.getElementById('resetMetricsBtn').addEventListener('click', resetMetrics);
    
    // Auto-refresh métricas cada 10s
    setInterval(() => {
        if (currentTab === 'metrics') {
            loadMetrics();
        }
    }, 10000);
}

async function loadMetrics() {
    try {
        const res = await fetch(`${API_BASE}/api/monitoring/metrics`);
        const data = await res.json();
        
        displayMetrics(data);
        
        // Actualizar uptime en header
        document.getElementById('uptimeDisplay').textContent = `Uptime: ${data.uptime.formatted}`;
    } catch (err) {
        console.error('Error cargando métricas:', err);
    }
}

function displayMetrics(data) {
    // Tarjetas de resumen
    document.getElementById('metricTotalRequests').textContent = data.requests.total;
    document.getElementById('metricTotalErrors').textContent = data.errors.total;
    document.getElementById('metricAvgResponse').textContent = `${data.performance.avgResponseTime}ms`;
    document.getElementById('metricPhotosUploaded').textContent = data.photos.uploaded;
    
    // Endpoints
    const endpointsList = document.getElementById('endpointsList');
    if (Object.keys(data.requests.byEndpoint).length === 0) {
        endpointsList.innerHTML = '<p class="text-gray-500 text-center py-4">No hay datos</p>';
    } else {
        const endpoints = Object.entries(data.requests.byEndpoint)
            .sort((a, b) => b[1] - a[1])
            .map(([endpoint, count]) => `
                <div class="flex justify-between items-center p-3 bg-gray-800 rounded hover:bg-gray-750 transition">
                    <span class="font-mono text-sm">${escapeHtml(endpoint)}</span>
                    <span class="font-semibold text-blue-400">${count}</span>
                </div>
            `).join('');
        endpointsList.innerHTML = endpoints;
    }
    
    // Status codes
    const statusCodesList = document.getElementById('statusCodesList');
    if (Object.keys(data.requests.byStatusCode).length === 0) {
        statusCodesList.innerHTML = '<p class="text-gray-500 text-center py-4">No hay datos</p>';
    } else {
        const codes = Object.entries(data.requests.byStatusCode)
            .sort((a, b) => b[1] - a[1])
            .map(([code, count]) => {
                const colorClass = code.startsWith('2') ? 'text-green-400' :
                                  code.startsWith('4') ? 'text-yellow-400' :
                                  code.startsWith('5') ? 'text-red-400' : 'text-gray-400';
                return `
                    <div class="flex justify-between items-center p-3 bg-gray-800 rounded">
                        <span class="font-semibold ${colorClass}">${code}</span>
                        <span class="font-semibold">${count}</span>
                    </div>
                `;
            }).join('');
        statusCodesList.innerHTML = codes;
    }
    
    // Performance
    const performanceDetails = document.getElementById('performanceDetails');
    performanceDetails.innerHTML = `
        <div class="flex justify-between p-3 bg-gray-800 rounded">
            <span class="text-gray-400">Promedio:</span>
            <span class="font-semibold">${data.performance.avgResponseTime}ms</span>
        </div>
        <div class="flex justify-between p-3 bg-gray-800 rounded">
            <span class="text-gray-400">Mínimo:</span>
            <span class="font-semibold text-green-400">${data.performance.minResponseTime}ms</span>
        </div>
        <div class="flex justify-between p-3 bg-gray-800 rounded">
            <span class="text-gray-400">Máximo:</span>
            <span class="font-semibold text-red-400">${data.performance.maxResponseTime}ms</span>
        </div>
    `;
    
    // System info
    const systemInfo = document.getElementById('systemInfo');
    const memoryMB = Math.round(data.system.memory.heapUsed / 1024 / 1024);
    const memoryTotalMB = Math.round(data.system.memory.heapTotal / 1024 / 1024);
    
    systemInfo.innerHTML = `
        <div class="flex justify-between p-2 border-b border-gray-700">
            <span class="text-gray-400">Node Version:</span>
            <span class="font-semibold">${data.system.nodeVersion}</span>
        </div>
        <div class="flex justify-between p-2 border-b border-gray-700">
            <span class="text-gray-400">Platform:</span>
            <span class="font-semibold">${data.system.platform}</span>
        </div>
        <div class="flex justify-between p-2 border-b border-gray-700">
            <span class="text-gray-400">Memory:</span>
            <span class="font-semibold">${memoryMB}MB / ${memoryTotalMB}MB</span>
        </div>
        <div class="flex justify-between p-2">
            <span class="text-gray-400">Uptime:</span>
            <span class="font-semibold">${data.uptime.formatted}</span>
        </div>
    `;
}

async function resetMetrics() {
    if (!confirm('¿Estás seguro de que quieres resetear todas las métricas?')) return;
    
    try {
        await fetch(`${API_BASE}/api/monitoring/metrics`, { method: 'DELETE' });
        loadMetrics();
        showSuccess('Métricas reseteadas exitosamente');
    } catch (err) {
        showError('endpointsList', 'Error al resetear métricas');
    }
}

// ===== TAB: TESTING =====
function initTestingTab() {
    const testButtons = document.querySelectorAll('[data-test]');
    
    testButtons.forEach(btn => {
        btn.addEventListener('click', async () => {
            const testType = btn.dataset.test;
            await runTest(testType, btn);
        });
    });
}

async function runTest(testType, btn) {
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>Ejecutando...';
    btn.disabled = true;
    
    const startTime = Date.now();
    let result;
    
    try {
        switch(testType) {
            case 'create-album':
                result = await fetch(`${API_BASE}/api/testing/create-test-album`, { method: 'POST' });
                break;
            
            case 'health-check':
                result = await fetch(`${API_BASE}/api/monitoring/health`);
                break;
            
            case 'cleanup':
                result = await fetch(`${API_BASE}/api/testing/cleanup-test-data`, { method: 'DELETE' });
                break;
            
            case 'error-500':
                result = await fetch(`${API_BASE}/api/testing/simulate-error?type=500`);
                break;
            
            case 'error-404':
                result = await fetch(`${API_BASE}/api/testing/simulate-error?type=404`);
                break;
            
            case 'slow-endpoint':
                const delay = document.getElementById('slowDelay').value;
                result = await fetch(`${API_BASE}/api/testing/slow-endpoint?delay=${delay}`);
                break;
        }
        
        const duration = Date.now() - startTime;
        const data = await result.json();
        
        const success = result.ok;
        appendTestResult(testType, success, data, duration);
        
    } catch (err) {
        const duration = Date.now() - startTime;
        appendTestResult(testType, false, { error: err.message }, duration);
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

function appendTestResult(testType, success, data, duration) {
    const resultsDiv = document.getElementById('testResults');
    
    const timestamp = new Date().toLocaleTimeString();
    const statusClass = success ? 'text-green-400' : 'text-red-400';
    const statusIcon = success ? 'fa-check-circle' : 'fa-times-circle';
    
    const resultHTML = `
        <div class="log-entry ${success ? 'log-info' : 'log-error'} mb-2">
            <div class="log-header">
                <span class="log-time">${timestamp}</span>
                <span class="log-level ${statusClass}">
                    <i class="fas ${statusIcon}"></i> ${success ? 'SUCCESS' : 'FAILED'}
                </span>
                <span class="text-gray-400 text-sm">${duration}ms</span>
            </div>
            <div class="log-message font-semibold">${testType.toUpperCase().replace(/-/g, ' ')}</div>
            <div class="log-metadata">${JSON.stringify(data, null, 2)}</div>
        </div>
    `;
    
    if (resultsDiv.innerHTML.includes('aparecerán aquí')) {
        resultsDiv.innerHTML = '';
    }
    
    resultsDiv.insertAdjacentHTML('afterbegin', resultHTML);
}

// ===== TAB: CONFIGURACIÓN =====
function initConfigTab() {
    document.getElementById('applyConfigBtn').addEventListener('click', applyConfig);
    loadCurrentConfig();
}

async function loadCurrentConfig() {
    try {
        const res = await fetch(`${API_BASE}/api/monitoring/metrics`);
        const data = await res.json();
        
        document.getElementById('configLogLevel').value = data.config.logLevel;
        document.getElementById('configConsoleLogging').checked = data.config.consoleLoggingEnabled;
        
        updateConfigDisplay(data.config);
    } catch (err) {
        console.error('Error cargando configuración:', err);
    }
}

async function applyConfig() {
    const logLevel = document.getElementById('configLogLevel').value;
    const consoleLogging = document.getElementById('configConsoleLogging').checked;
    
    try {
        // Actualizar nivel de log
        await fetch(`${API_BASE}/api/monitoring/log-level`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ level: logLevel })
        });
        
        // Actualizar console logging
        await fetch(`${API_BASE}/api/monitoring/console-logging`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled: consoleLogging })
        });
        
        showSuccess('Configuración aplicada exitosamente');
        loadCurrentConfig();
        loadLogs(); // Recargar logs con nuevo nivel
        
    } catch (err) {
        showError('currentConfig', 'Error al aplicar configuración');
    }
}

function updateConfigDisplay(config) {
    const currentConfig = document.getElementById('currentConfig');
    
    currentConfig.innerHTML = `
        <div class="flex justify-between p-3 bg-gray-800 rounded">
            <span class="text-gray-400">Nivel de Log:</span>
            <span class="font-semibold">${config.logLevel}</span>
        </div>
        <div class="flex justify-between p-3 bg-gray-800 rounded">
            <span class="text-gray-400">Console Logging:</span>
            <span class="font-semibold ${config.consoleLoggingEnabled ? 'text-green-400' : 'text-red-400'}">
                ${config.consoleLoggingEnabled ? 'Habilitado' : 'Deshabilitado'}
            </span>
        </div>
    `;
}

// ===== UTILIDADES =====
function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
}

function showSuccess(message) {
    // Podrías usar un toast o notificación
    console.log('✅', message);
}

function showError(elementId, message) {
    const element = document.getElementById(elementId);
    if (element) {
        element.innerHTML = `<p class="text-red-400 text-center py-4"><i class="fas fa-exclamation-triangle mr-2"></i>${message}</p>`;
    }
    console.error('❌', message);
}
