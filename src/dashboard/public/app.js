/**
 * TrafficControl Dashboard - Client-side JavaScript
 * Handles data fetching, real-time updates via SSE, and UI interactions
 */

// Configuration
const CONFIG = {
  refreshInterval: 30000, // 30 seconds
  apiBase: '/api',
};

// State
let state = {
  status: null,
  projects: [],
  agents: [],
  tasks: [],
  recommendations: [],
  connected: false,
  eventSource: null,
  startTime: Date.now(),
};

// DOM Elements cache
const elements = {};

/**
 * Initialize the dashboard
 */
function init() {
  cacheElements();
  setupEventSource();
  refreshDashboard();
  startUptimeCounter();

  // Auto-refresh every 30 seconds
  setInterval(refreshDashboard, CONFIG.refreshInterval);
}

/**
 * Cache DOM elements for performance
 */
function cacheElements() {
  elements.statusText = document.getElementById('status-text');
  elements.uptime = document.getElementById('uptime');
  elements.lastUpdated = document.getElementById('last-updated');
  elements.opusCapacity = document.getElementById('opus-capacity');
  elements.opusBar = document.getElementById('opus-bar');
  elements.sonnetCapacity = document.getElementById('sonnet-capacity');
  elements.sonnetBar = document.getElementById('sonnet-bar');
  elements.tasksCompleted = document.getElementById('tasks-completed');
  elements.tokensUsed = document.getElementById('tokens-used');
  elements.costToday = document.getElementById('cost-today');
  elements.interventions = document.getElementById('interventions');
  elements.projectsGrid = document.getElementById('projects-grid');
  elements.projectCount = document.getElementById('project-count');
  elements.recommendationsList = document.getElementById('recommendations-list');
  elements.agentsTable = document.getElementById('agents-table');
  elements.agentCount = document.getElementById('agent-count');
  elements.taskQueue = document.getElementById('task-queue');
  elements.queueCount = document.getElementById('queue-count');
}

/**
 * Setup Server-Sent Events for real-time updates
 */
function setupEventSource() {
  if (state.eventSource) {
    state.eventSource.close();
  }

  state.eventSource = new EventSource(`${CONFIG.apiBase}/events`);

  state.eventSource.onopen = () => {
    state.connected = true;
    updateConnectionStatus(true);
  };

  state.eventSource.onerror = () => {
    state.connected = false;
    updateConnectionStatus(false);
    // Attempt reconnect after 5 seconds
    setTimeout(setupEventSource, 5000);
  };

  state.eventSource.addEventListener('connected', (e) => {
    console.log('SSE connected:', JSON.parse(e.data));
  });

  state.eventSource.addEventListener('taskUpdated', (e) => {
    const data = JSON.parse(e.data);
    console.log('Task updated:', data);
    refreshTasks();
  });

  state.eventSource.addEventListener('projectPaused', (e) => {
    const data = JSON.parse(e.data);
    console.log('Project paused:', data);
    refreshProjects();
  });

  state.eventSource.addEventListener('projectResumed', (e) => {
    const data = JSON.parse(e.data);
    console.log('Project resumed:', data);
    refreshProjects();
  });

  state.eventSource.addEventListener('agentStarted', (e) => {
    const data = JSON.parse(e.data);
    console.log('Agent started:', data);
    refreshAgents();
    refreshStatus();
  });

  state.eventSource.addEventListener('agentCompleted', (e) => {
    const data = JSON.parse(e.data);
    console.log('Agent completed:', data);
    refreshAgents();
    refreshStatus();
  });
}

/**
 * Update connection status indicator
 */
function updateConnectionStatus(connected) {
  if (elements.statusText) {
    elements.statusText.textContent = connected ? 'OPERATIONAL' : 'RECONNECTING...';
    elements.statusText.parentElement.querySelector('.status-dot')
      .classList.toggle('bg-accent-red', !connected);
    elements.statusText.parentElement.querySelector('.status-dot')
      .classList.toggle('bg-accent-green', connected);
  }
}

/**
 * Refresh all dashboard data
 */
async function refreshDashboard() {
  await Promise.all([
    refreshStatus(),
    refreshProjects(),
    refreshAgents(),
    refreshTasks(),
    refreshRecommendations(),
  ]);

  updateLastUpdated();
}

/**
 * Fetch and update system status
 */
async function refreshStatus() {
  try {
    const response = await fetch(`${CONFIG.apiBase}/status`);
    if (!response.ok) throw new Error('Failed to fetch status');

    state.status = await response.json();
    renderStatus();
  } catch (error) {
    console.error('Error fetching status:', error);
  }
}

/**
 * Render system status
 */
function renderStatus() {
  if (!state.status) return;

  const { capacity, todayStats } = state.status;

  // Update capacity bars
  if (capacity.opus) {
    const opusPercent = (capacity.opus.current / capacity.opus.limit) * 100;
    elements.opusCapacity.textContent = `${capacity.opus.current} / ${capacity.opus.limit}`;
    elements.opusBar.style.width = `${opusPercent}%`;
  }

  if (capacity.sonnet) {
    const sonnetPercent = (capacity.sonnet.current / capacity.sonnet.limit) * 100;
    elements.sonnetCapacity.textContent = `${capacity.sonnet.current} / ${capacity.sonnet.limit}`;
    elements.sonnetBar.style.width = `${sonnetPercent}%`;
  }

  // Update today's stats
  elements.tasksCompleted.textContent = todayStats.tasksCompleted.toLocaleString();
  elements.tokensUsed.textContent = Math.round(todayStats.tokensUsed / 1000).toLocaleString();
  elements.costToday.textContent = todayStats.costUsd.toFixed(2);
  elements.interventions.textContent = todayStats.interventions.toLocaleString();
}

/**
 * Fetch and update projects
 */
async function refreshProjects() {
  try {
    const response = await fetch(`${CONFIG.apiBase}/projects`);
    if (!response.ok) throw new Error('Failed to fetch projects');

    state.projects = await response.json();
    renderProjects();
  } catch (error) {
    console.error('Error fetching projects:', error);
  }
}

/**
 * Render project cards
 */
function renderProjects() {
  if (state.projects.length === 0) {
    elements.projectsGrid.innerHTML = `
      <div class="col-span-2 bg-surface-800 rounded-lg p-8 border border-border-subtle text-center">
        <div class="text-white/30 text-sm">No active projects</div>
        <div class="text-white/20 text-xs mt-2">Projects will appear here when created</div>
      </div>
    `;
    elements.projectCount.textContent = '0 active';
    return;
  }

  elements.projectCount.textContent = `${state.projects.length} active`;

  elements.projectsGrid.innerHTML = state.projects.map(project => `
    <div class="project-card bg-surface-800 rounded-lg p-5 border border-border-subtle">
      <div class="flex items-start justify-between mb-4">
        <div>
          <h3 class="font-display font-semibold text-sm">${escapeHtml(project.name)}</h3>
          <div class="flex items-center gap-2 mt-1">
            <span class="inline-flex items-center gap-1 text-xs ${project.status === 'active' ? 'text-accent-green' : 'text-accent-amber'}">
              <span class="w-1.5 h-1.5 rounded-full ${project.status === 'active' ? 'bg-accent-green' : 'bg-accent-amber'}"></span>
              ${project.status}
            </span>
          </div>
        </div>
        <div class="flex gap-1">
          ${project.status === 'active' ? `
            <button onclick="pauseProject('${project.id}')" class="btn p-1.5 bg-surface-700 hover:bg-surface-600 rounded text-xs border border-border-subtle" title="Pause project">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
              </svg>
            </button>
          ` : `
            <button onclick="resumeProject('${project.id}')" class="btn p-1.5 bg-surface-700 hover:bg-surface-600 rounded text-xs border border-border-subtle" title="Resume project">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"/>
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
              </svg>
            </button>
          `}
        </div>
      </div>

      <div class="grid grid-cols-2 gap-3 text-xs">
        <div class="bg-surface-700/50 rounded p-2.5">
          <div class="text-white/40 mb-1">Agents</div>
          <div class="font-semibold text-accent-purple">${project.activeAgents}</div>
        </div>
        <div class="bg-surface-700/50 rounded p-2.5">
          <div class="text-white/40 mb-1">Queue</div>
          <div class="font-semibold">${project.queuedTasks}</div>
        </div>
        <div class="bg-surface-700/50 rounded p-2.5">
          <div class="text-white/40 mb-1">Blocked</div>
          <div class="font-semibold ${project.blockedTasks > 0 ? 'text-accent-red' : ''}">${project.blockedTasks}</div>
        </div>
        <div class="bg-surface-700/50 rounded p-2.5">
          <div class="text-white/40 mb-1">Cost</div>
          <div class="font-semibold text-accent-amber">$${project.costToday.toFixed(2)}</div>
        </div>
      </div>

      <div class="mt-4 pt-3 border-t border-border-subtle">
        <div class="flex items-center justify-between text-xs">
          <span class="text-white/40">Completion</span>
          <span class="font-semibold text-accent-green">${Math.round(project.roi)}%</span>
        </div>
        <div class="h-1 bg-surface-600 rounded-full mt-2 overflow-hidden">
          <div class="h-full bg-gradient-to-r from-accent-green to-accent-cyan rounded-full transition-all duration-500" style="width: ${project.roi}%"></div>
        </div>
      </div>
    </div>
  `).join('');
}

/**
 * Fetch and update agents
 */
async function refreshAgents() {
  try {
    const response = await fetch(`${CONFIG.apiBase}/agents`);
    if (!response.ok) throw new Error('Failed to fetch agents');

    state.agents = await response.json();
    renderAgents();
  } catch (error) {
    console.error('Error fetching agents:', error);
  }
}

/**
 * Render agents table
 */
function renderAgents() {
  if (state.agents.length === 0) {
    elements.agentsTable.innerHTML = `
      <tr>
        <td colspan="5" class="p-4 text-center text-white/30 text-sm">No active agents</td>
      </tr>
    `;
    elements.agentCount.textContent = '0 running';
    return;
  }

  elements.agentCount.textContent = `${state.agents.length} running`;

  elements.agentsTable.innerHTML = state.agents.map(agent => `
    <tr class="border-b border-border-subtle hover:bg-surface-700/30">
      <td class="p-3">
        <span class="font-mono text-xs text-white/60">${agent.sessionId.slice(0, 8)}...</span>
      </td>
      <td class="p-3">
        <span class="model-badge model-${agent.model}">${agent.model}</span>
      </td>
      <td class="p-3">
        <span class="text-sm">${agent.task ? escapeHtml(agent.task.title.slice(0, 30)) : 'N/A'}${agent.task && agent.task.title.length > 30 ? '...' : ''}</span>
      </td>
      <td class="p-3">
        <span class="inline-flex items-center gap-1.5 text-xs status-${agent.status}">
          <span class="w-1.5 h-1.5 rounded-full ${getStatusColor(agent.status)}"></span>
          ${agent.status}
        </span>
      </td>
      <td class="p-3">
        <span class="text-xs tabular-nums text-white/60">${(agent.tokensUsed / 1000).toFixed(1)}K</span>
      </td>
    </tr>
  `).join('');
}

/**
 * Fetch and update tasks
 */
async function refreshTasks() {
  try {
    const response = await fetch(`${CONFIG.apiBase}/tasks`);
    if (!response.ok) throw new Error('Failed to fetch tasks');

    state.tasks = await response.json();
    renderTasks();
  } catch (error) {
    console.error('Error fetching tasks:', error);
  }
}

/**
 * Render task queue
 */
function renderTasks() {
  if (state.tasks.length === 0) {
    elements.taskQueue.innerHTML = `
      <div class="p-4 text-center text-white/30 text-sm">No tasks in queue</div>
    `;
    elements.queueCount.textContent = '0 queued';
    return;
  }

  elements.queueCount.textContent = `${state.tasks.length} queued`;

  elements.taskQueue.innerHTML = state.tasks.map(task => `
    <div class="p-3 hover:bg-surface-700/30 flex items-center justify-between gap-3">
      <div class="flex-1 min-w-0">
        <div class="text-sm truncate">${escapeHtml(task.title)}</div>
        <div class="text-xs text-white/40 mt-0.5">
          Priority: ${task.priority}
          ${task.complexity_estimate ? ` | ${task.complexity_estimate}` : ''}
        </div>
      </div>
      <div class="flex items-center gap-2">
        <button onclick="updatePriority('${task.id}', ${task.priority + 1})" class="btn p-1 bg-surface-600 hover:bg-surface-500 rounded text-xs" title="Increase priority">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7"/>
          </svg>
        </button>
        <button onclick="updatePriority('${task.id}', ${Math.max(0, task.priority - 1)})" class="btn p-1 bg-surface-600 hover:bg-surface-500 rounded text-xs" title="Decrease priority">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/>
          </svg>
        </button>
      </div>
    </div>
  `).join('');
}

/**
 * Fetch and update recommendations
 */
async function refreshRecommendations() {
  try {
    const response = await fetch(`${CONFIG.apiBase}/recommendations`);
    if (!response.ok) throw new Error('Failed to fetch recommendations');

    const data = await response.json();
    state.recommendations = data.recommendations || [];
    renderRecommendations();
  } catch (error) {
    console.error('Error fetching recommendations:', error);
  }
}

/**
 * Render recommendations
 */
function renderRecommendations() {
  if (state.recommendations.length === 0) {
    elements.recommendationsList.innerHTML = `
      <div class="bg-surface-800 rounded-lg p-4 border border-border-subtle text-center">
        <div class="text-white/30 text-sm">No recommendations</div>
        <div class="text-white/20 text-xs mt-1">System is running optimally</div>
      </div>
    `;
    return;
  }

  elements.recommendationsList.innerHTML = state.recommendations.map(rec => `
    <div class="bg-surface-800 rounded-lg p-3 border border-border-subtle priority-${rec.priority}">
      <div class="flex items-start gap-3">
        <div class="mt-0.5">
          ${getPriorityIcon(rec.priority)}
        </div>
        <div class="flex-1 min-w-0">
          <div class="text-xs text-white/80">${escapeHtml(rec.message)}</div>
          ${rec.projectName ? `<div class="text-xs text-white/40 mt-1">Project: ${escapeHtml(rec.projectName)}</div>` : ''}
        </div>
        <span class="priority-badge priority-${rec.priority}">${rec.priority}</span>
      </div>
    </div>
  `).join('');
}

/**
 * Update task priority
 */
async function updatePriority(taskId, newPriority) {
  try {
    const response = await fetch(`${CONFIG.apiBase}/tasks/${taskId}/priority`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ priority: newPriority }),
    });

    if (!response.ok) throw new Error('Failed to update priority');

    await refreshTasks();
  } catch (error) {
    console.error('Error updating priority:', error);
    alert('Failed to update task priority');
  }
}

/**
 * Pause a project
 */
async function pauseProject(projectId) {
  try {
    const response = await fetch(`${CONFIG.apiBase}/projects/${projectId}/pause`, {
      method: 'POST',
    });

    if (!response.ok) throw new Error('Failed to pause project');

    await refreshProjects();
  } catch (error) {
    console.error('Error pausing project:', error);
    alert('Failed to pause project');
  }
}

/**
 * Resume a project
 */
async function resumeProject(projectId) {
  try {
    const response = await fetch(`${CONFIG.apiBase}/projects/${projectId}/resume`, {
      method: 'POST',
    });

    if (!response.ok) throw new Error('Failed to resume project');

    await refreshProjects();
  } catch (error) {
    console.error('Error resuming project:', error);
    alert('Failed to resume project');
  }
}

/**
 * Start uptime counter
 */
function startUptimeCounter() {
  setInterval(() => {
    if (state.status) {
      const uptime = state.status.uptime || (Date.now() - state.startTime);
      elements.uptime.textContent = formatUptime(uptime);
    }
  }, 1000);
}

/**
 * Update last updated timestamp
 */
function updateLastUpdated() {
  const now = new Date();
  elements.lastUpdated.textContent = `Updated: ${now.toLocaleTimeString()}`;
}

/**
 * Format uptime in HH:MM:SS
 */
function formatUptime(ms) {
  const seconds = Math.floor(ms / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Get status color class
 */
function getStatusColor(status) {
  const colors = {
    running: 'bg-accent-green',
    blocked: 'bg-accent-amber',
    failed: 'bg-accent-red',
    complete: 'bg-accent-cyan',
    waiting_approval: 'bg-accent-purple',
  };
  return colors[status] || 'bg-white/40';
}

/**
 * Get priority icon SVG
 */
function getPriorityIcon(priority) {
  const icons = {
    critical: `<svg class="w-4 h-4 text-accent-red" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
    </svg>`,
    warning: `<svg class="w-4 h-4 text-accent-amber" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
    </svg>`,
    info: `<svg class="w-4 h-4 text-accent-cyan" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
    </svg>`,
    positive: `<svg class="w-4 h-4 text-accent-green" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
    </svg>`,
  };
  return icons[priority] || icons.info;
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Initialize on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// Export for global access
window.refreshDashboard = refreshDashboard;
window.updatePriority = updatePriority;
window.pauseProject = pauseProject;
window.resumeProject = resumeProject;
