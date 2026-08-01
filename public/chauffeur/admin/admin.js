document.addEventListener('DOMContentLoaded', function () {
  checkAdminSession();
});

async function checkAdminSession() {
  try {
    const res = await fetch('/api/admin/me');
    const data = await res.json();

    if (!data.loggedIn) {
      window.location.href = '/login.html';
      return;
    }

    document.getElementById('adminNameChip').textContent = data.admin.name || data.admin.email;
    loadChauffeurs();
  } catch (err) {
    window.location.href = '/login.html';
  }
}

function switchSection(sectionId, btnEl) {
  document.querySelectorAll('.admin-view-panel').forEach(p => p.classList.remove('active'));
  document.getElementById(sectionId).classList.add('active');

  document.querySelectorAll('.sidebar-link').forEach(b => b.classList.remove('active'));
  btnEl.classList.add('active');

  document.getElementById('pageTitle').textContent = btnEl.textContent.trim().replace(/^[^\w]+/, '');

  if (sectionId === 'chauffeursSection') loadChauffeurs();
  if (sectionId === 'bookingsSection') loadChauffeursIntoSelect();
  if (sectionId === 'attendanceSection') loadAttendance();
}

// ---------- CHAUFFEURS & BOOKINGS / RESPONSES ----------
async function loadChauffeursIntoSelect() {
  const select = document.getElementById('bookingsChauffeurSelect');
  select.innerHTML = '<option value="">Select a chauffeur...</option>';

  try {
    const res = await fetch('/api/admin/chauffeurs');
    const data = await res.json();
    if (!res.ok) return;

    (data.chauffeurs || []).forEach(c => {
      const opt = document.createElement('option');
      opt.value = c._id;
      // Capitalizing the first letter of each word in the name
      const formattedName = c.name ? c.name.split(' ').map(word => {
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
      }).join(' ') : 'Unknown';
      opt.textContent = `${formattedName} (${c.number})`;
      select.appendChild(opt);
    });
  } catch (err) {
    console.error('Error loading chauffeurs into select:', err);
  }
}

async function loadBookingWidgets() {
  const chauffeurId = document.getElementById('bookingsChauffeurSelect').value;
  const date = document.getElementById('bookingsDateInput').value;
  const container = document.getElementById('bookingWidgetsContainer');
  const responseContainer = document.getElementById('responseDetailContainer');

  responseContainer.innerHTML = '<p class="empty-text">Click a booking above to view its response.</p>';

  if (!chauffeurId || !date) {
    showToast('Please select both a chauffeur and a date.', 'error');
    return;
  }

  container.innerHTML = '<p class="empty-text">Loading bookings...</p>';

  try {
    const res = await fetch(`/api/admin/responses/booking-ids?chauffeurId=${chauffeurId}&date=${date}`);
    const data = await res.json();

    if (!res.ok) {
      container.innerHTML = `<p class="empty-text">Error: ${data.error || 'Could not load bookings.'}</p>`;
      return;
    }

    if (!data.bookings || data.bookings.length === 0) {
      container.innerHTML = '<p class="empty-text">No bookings found for this chauffeur on this date.</p>';
      return;
    }

    container.innerHTML = data.bookings.map(b => `
      <div class="chauffeur-row" style="cursor:pointer;" onclick="loadResponseDetail('${chauffeurId}', '${date}', '${b.bookingId}')">
        <div>
          <div class="chauffeur-row-name">Booking ${b.bookingId} — ${b.customerName}</div>
          <div class="chauffeur-row-number">${b.dateTime} · Pickup: ${b.pickupAddress || 'N/A'} · Drop: ${b.dropAddress || 'N/A'}</div>
        </div>
      </div>
    `).join('');
  } catch (err) {
    container.innerHTML = `<p class="empty-text">Network error: ${err.message}</p>`;
  }
}

var currentResponseDetail = null;

async function loadResponseDetail(chauffeurId, date, bookingId) {
  const container = document.getElementById('responseDetailContainer');
  container.innerHTML = '<p class="empty-text">Loading response...</p>';

  try {
    const res = await fetch(`/api/admin/responses/booking-detail?chauffeurId=${chauffeurId}&date=${date}&bookingId=${bookingId}`);
    const data = await res.json();

    if (!res.ok) {
      container.innerHTML = `<p class="empty-text">Error: ${data.error || 'Could not load response.'}</p>`;
      return;
    }

    currentResponseDetail = data;
    renderResponseDetail(data, false);
  } catch (err) {
    container.innerHTML = `<p class="empty-text">Network error: ${err.message}</p>`;
  }
}

function renderResponseDetail(data, editMode) {
  const container = document.getElementById('responseDetailContainer');
  const f = data.fields;

  const fieldRow = (label, key, value) => editMode
    ? `<div class="form-row" style="margin-bottom:8px;"><label style="flex:0 0 180px; font-size:12.5px; font-weight:600; align-self:center;">${label}</label><input type="text" id="edit_${key}" value="${(value || '').replace(/"/g, '&quot;')}" style="flex:1;"></div>`
    : `<div style="display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid var(--border); font-size:13.5px;"><span style="color:var(--muted);">${label}</span><span style="font-weight:600;">${value || '—'}</span></div>`;

  container.innerHTML = `
    <div style="margin-bottom:16px;">
      <div style="font-weight:800; font-size:15px;">Booking ${data.bookingId} — ${data.chauffeurName}</div>
    </div>

    <div style="display:flex; gap:20px; margin-bottom:20px; flex-wrap:wrap;">
      <div>
        <div style="font-size:12px; font-weight:700; color:var(--muted); margin-bottom:6px;">Vehicle Readiness Photo</div>
        ${data.readinessImageUrl ? `<img src="${data.readinessImageUrl}" style="width:200px; border-radius:8px; border:1px solid var(--border);">` : '<p class="empty-text">No photo</p>'}
      </div>
      <div>
        <div style="font-size:12px; font-weight:700; color:var(--muted); margin-bottom:6px;">End Shift Photo</div>
        ${data.endShiftImageUrl ? `<img src="${data.endShiftImageUrl}" style="width:200px; border-radius:8px; border:1px solid var(--border);">` : '<p class="empty-text">No photo</p>'}
      </div>
    </div>

    <div style="font-weight:700; font-size:13.5px; margin-bottom:8px;">Pre-Ride Checklist</div>
    ${fieldRow('Car Cleaned', 'carCleaned', f.carCleaned)}
    ${fieldRow('Phone Charged', 'phoneCharged', f.phoneCharged)}
    ${fieldRow('Enough Petrol', 'enoughPetrol', f.enoughPetrol)}

    <div style="font-weight:700; font-size:13.5px; margin:16px 0 8px;">Ride Completion Report</div>
    ${fieldRow('Status', 'status', f.status)}
    ${fieldRow('Guest Details Correct', 'guestDetails', f.guestDetails)}
    ${fieldRow('Luggage Details Correct', 'luggageDetails', f.luggageDetails)}
    ${fieldRow('Operational Issues', 'operationalIssues', f.operationalIssues)}
    ${fieldRow('Issue Checkboxes', 'checkboxAnswers', f.checkboxAnswers)}
    ${fieldRow('Issue Description', 'issueDescription', f.issueDescription)}
    ${fieldRow('Guest Feedback', 'guestFeedbackOptions', f.guestFeedbackOptions)}
    ${fieldRow('Feedback Text', 'guestFeedbackText', f.guestFeedbackText)}
    ${fieldRow('Remarks', 'remarks', f.remarks)}

    <div style="margin-top:20px; display:flex; gap:10px;">
      ${editMode
        ? `<button class="btn btn-primary" onclick="saveResponseEdit()">Save Changes</button><button class="btn btn-danger" onclick="renderResponseDetail(currentResponseDetail, false)">Cancel</button>`
        : `<button class="btn btn-primary" onclick="renderResponseDetail(currentResponseDetail, true)">Edit</button>`
      }
    </div>
  `;
}

async function saveResponseEdit() {
  const keys = ['carCleaned', 'phoneCharged', 'enoughPetrol', 'status', 'guestDetails', 'luggageDetails', 'operationalIssues', 'checkboxAnswers', 'issueDescription', 'guestFeedbackOptions', 'guestFeedbackText', 'remarks'];
  const fields = {};
  keys.forEach(k => {
    const el = document.getElementById(`edit_${k}`);
    fields[k] = el ? el.value : '';
  });

  try {
    const res = await fetch('/api/admin/responses/booking-detail', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rowIndex: currentResponseDetail.rowIndex, fields })
    });
    const data = await res.json();

    if (!res.ok || data.error) {
      showToast(data.error || 'Failed to save.', 'error');
      return;
    }

    showToast('Response updated successfully.', 'success');
    currentResponseDetail.fields = fields;
    renderResponseDetail(currentResponseDetail, false);
  } catch (err) {
    showToast('Network error: ' + err.message, 'error');
  }
}

async function handleAdminLogout() {
  if (!confirm('Are you sure you want to log out?')) return;
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
  } catch (err) {
    console.error('Logout error:', err);
  }
  window.location.href = '/login.html';
}

function showToast(msg, type = 'success') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast ${type} show`;
  setTimeout(() => { t.className = 'toast'; }, 3000);
}

// ---------- MANAGE CHAUFFEURS ----------
async function loadChauffeurs() {
  const container = document.getElementById('chauffeurListContainer');
  container.innerHTML = '<p class="empty-text">Loading chauffeurs...</p>';

  try {
    const res = await fetch('/api/admin/chauffeurs');
    const data = await res.json();

    if (!res.ok) {
      container.innerHTML = `<p class="empty-text">Error: ${data.error || 'Could not load chauffeurs.'}</p>`;
      return;
    }

    if (!data.chauffeurs || data.chauffeurs.length === 0) {
      container.innerHTML = '<p class="empty-text">No chauffeurs added yet.</p>';
      return;
    }

    container.innerHTML = data.chauffeurs.map(c => {
      // Capitalizing the first letter of each word in the name
      const formattedName = c.name ? c.name.split(' ').map(word => {
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
      }).join(' ') : 'Unknown';

      return `
      <div class="chauffeur-row">
        <div>
          <div class="chauffeur-row-name">${formattedName}</div>
          <div class="chauffeur-row-number">${c.number}</div>
        </div>
        <button class="btn btn-danger" onclick="deleteChauffeur('${c._id}', '${c.name.replace(/'/g, "\\'")}')">Delete</button>
      </div>
      `;
    }).join('');
  } catch (err) {
    container.innerHTML = `<p class="empty-text">Network error: ${err.message}</p>`;
  }
}

async function addChauffeur() {
  const nameInput = document.getElementById('newChauffeurName');
  const numberInput = document.getElementById('newChauffeurNumber');
  const name = nameInput.value.trim();
  const number = numberInput.value.trim();

  if (!name || !number) {
    showToast('Please enter both name and mobile number.', 'error');
    return;
  }

  try {
    const res = await fetch('/api/admin/chauffeurs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, number })
    });
    const data = await res.json();

    if (!res.ok || data.error) {
      showToast(data.error || 'Failed to add chauffeur.', 'error');
      return;
    }

    nameInput.value = '';
    numberInput.value = '';
    showToast('Chauffeur added successfully.', 'success');
    loadChauffeurs();
  } catch (err) {
    showToast('Network error: ' + err.message, 'error');
  }
}

async function deleteChauffeur(id, name) {
  if (!confirm(`Delete chauffeur "${name}"? This cannot be undone.`)) return;

  try {
    const res = await fetch(`/api/admin/chauffeurs/${id}`, { method: 'DELETE' });
    const data = await res.json();

    if (!res.ok || data.error) {
      showToast(data.error || 'Failed to delete chauffeur.', 'error');
      return;
    }

    showToast('Chauffeur deleted.', 'success');
    loadChauffeurs();
  } catch (err) {
    showToast('Network error: ' + err.message, 'error');
  }
}

// ─────────────────────────────────────────────
// ATTENDANCE MANAGEMENT
// ─────────────────────────────────────────────
let attendanceData = [];
let activeId = null;   // chauffeurId being acted on
let activeName = null;

// Radio selection styling listener
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.radio-label input[type=radio]').forEach(radio => {
        radio.addEventListener('change', () => {
            document.querySelectorAll('.radio-label').forEach(l => l.classList.remove('selected'));
            radio.closest('.radio-label').classList.add('selected');
        });
    });
});

async function loadAttendance() {
    const grid = document.getElementById('chauffeur-grid');
    grid.innerHTML = `<div class="loading-state"><div class="spinner"></div><div>Loading chauffeur data…</div></div>`;

    document.getElementById('today-label').textContent =
        `Today — ${new Date().toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'long', year:'numeric' })}`;

    try {
        const res = await fetch('/api/admin/attendance/chauffeurs-with-mtd');
        if (!res.ok) throw new Error('Server error');
        attendanceData = await res.json();
        renderAttendanceGrid(attendanceData);
    } catch (e) {
        grid.innerHTML = `<div class="empty-state"><div class="empty-title">Could not load data</div><div class="empty-sub">${e.message}</div></div>`;
    }
}

function getCardClass(status) {
    if (!status) return '';
    if (status === 'Present-Day')   return 'status-day';
    if (status === 'Present-Night') return 'status-night';
    if (status === 'Absent')        return 'status-absent';
    if (status === 'Leave')         return 'status-leave';
    if (status === 'Weekly-Off')    return 'status-wo';
    return '';
}

function getTodayBadge(status) {
    if (!status) return `<span class="today-badge unmarked">Not Marked</span>`;
    if (status === 'Present-Day')   return `<span class="today-badge day">Day</span>`;
    if (status === 'Present-Night') return `<span class="today-badge night">Night</span>`;
    if (status === 'Absent')        return `<span class="today-badge absent">Absent</span>`;
    if (status === 'Leave')         return `<span class="today-badge leave">Leave</span>`;
    if (status === 'Weekly-Off')    return `<span class="today-badge wo">Weekly Off</span>`;
    return '';
}

function fmtOT(minutes) {
    if (!minutes) return '<span class="mtd-val ot">0</span><span class="mtd-unit">hrs</span>';
    const hrs = (minutes / 60).toFixed(1);
    const display = hrs.endsWith('.0') ? hrs.slice(0, -2) : hrs;
    return `<span class="mtd-val ot">${display}</span><span class="mtd-unit">hrs</span>`;
}

function getInitials(name) {
    return name.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
}

function renderAttendanceGrid(data) {
    const grid = document.getElementById('chauffeur-grid');
    if (!data.length) {
        grid.innerHTML = `<div class="empty-state"><div class="empty-title">No Active Chauffeurs</div><div class="empty-sub">Add chauffeurs in the Manage Chauffeurs tab to see them here.</div></div>`;
        return;
    }

    grid.innerHTML = data.map(c => {
        const cardClass = getCardClass(c.todayStatus);
        const badge = getTodayBadge(c.todayStatus);
        const initials = getInitials(c.name);

        const btnText = c.todayStatus ? 'Marked for today' : "Mark Today's";

        return `
<div class="chauffeur-card ${cardClass}" id="card-${c._id}">
    <div class="card-header">
        <div class="avatar">${initials}</div>
        <div>
            <div class="card-name">${c.name}</div>
            <div class="card-mobile">${c.mobileNo}</div>
        </div>
        ${badge}
    </div>

    <div class="mtd-section">
        <div class="mtd-label">Month-to-Date</div>
        <div class="mtd-rows">
            <div class="mtd-row">
                <div class="mtd-row-left"><div class="mtd-dot dot-day"></div>Present – Day</div>
                <div><span class="mtd-val">${c.mtd.presentDay}</span><span class="mtd-unit">days</span></div>
            </div>
            <div class="mtd-row">
                <div class="mtd-row-left"><div class="mtd-dot dot-night"></div>Present – Night</div>
                <div><span class="mtd-val">${c.mtd.presentNight}</span><span class="mtd-unit">days</span></div>
            </div>
            <div class="mtd-row">
                <div class="mtd-row-left"><div class="mtd-dot dot-absent"></div>Absent</div>
                <div><span class="mtd-val">${c.mtd.absent}</span><span class="mtd-unit">days</span></div>
            </div>
            <div class="mtd-row">
                <div class="mtd-row-left"><div class="mtd-dot dot-leave"></div>Leave</div>
                <div><span class="mtd-val">${c.mtd.leave}</span><span class="mtd-unit">days</span></div>
            </div>
            <div class="mtd-row">
                <div class="mtd-row-left"><div class="mtd-dot dot-ot"></div>Overtime</div>
                <div>${fmtOT(c.mtd.overtimeMinutes)}</div>
            </div>
        </div>
    </div>

    <div class="card-actions">
        <button class="btn btn-primary" style="width:100%;" id="mark-btn-${c._id}" onclick="openMarkModal('${c._id}','${c.name.replace(/'/g,"\\'")}')">${btnText}</button>
    </div>
    <div style="padding:0 18px 14px;">
        <button style="width:100%;font-size:11.5px;font-weight:600;color:var(--muted);background:none;border:none;cursor:pointer;text-align:center;padding:6px 0;" onclick="openHistory('${c._id}','${c.name.replace(/'/g,"\\'")}')">
            View History
        </button>
    </div>
</div>`;
    }).join('');
}

function openMarkModal(id, name) {
    activeId = id;
    activeName = name;
    document.getElementById('mark-name').textContent = name;

    // Clear previous selection
    document.querySelectorAll('#status-radios input[type=radio]').forEach(r => r.checked = false);
    document.querySelectorAll('.radio-label').forEach(l => l.classList.remove('selected'));

    // Pre-select current status if already marked
    const chauffeur = attendanceData.find(c => c._id === id);
    if (chauffeur && chauffeur.todayStatus) {
        const map = {
            'Present-Day': 'r-day',
            'Present-Night': 'r-night',
            'Absent': 'r-absent',
            'Leave': 'r-leave',
            'Weekly-Off': 'r-wo'
        };
        const radioId = map[chauffeur.todayStatus];
        if (radioId) {
            const radio = document.getElementById(radioId);
            radio.checked = true;
            radio.closest('.radio-label').classList.add('selected');
        }
    }

    document.getElementById('mark-modal').classList.add('open');
}

async function submitMarkToday() {
    const selected = document.querySelector('#status-radios input[type=radio]:checked');
    if (!selected) { showToast('Please select a status.', 'error'); return; }

    try {
        const res = await fetch('/api/admin/attendance/mark-today', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chauffeurId: activeId, status: selected.value })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed');
        showToast(`${activeName} marked as ${selected.value}`, 'success');
        closeModal('mark-modal');
        loadAttendance();
    } catch (e) {
        showToast(e.message, 'error');
    }
}



async function openHistory(id, name) {
    document.getElementById('hist-modal-sub').textContent = `Full attendance log for ${name}`;
    document.getElementById('hist-tbody').innerHTML = '<tr><td colspan="4" style="text-align:center;padding:20px;color:var(--muted);">Loading…</td></tr>';
    document.getElementById('hist-modal').classList.add('open');

    try {
        const res = await fetch(`/api/admin/attendance/history/${id}`);
        const records = await res.json();
        if (!records.length) {
            document.getElementById('hist-tbody').innerHTML =
                '<tr><td colspan="3" style="text-align:center;padding:20px;color:var(--muted);">No records found.</td></tr>';
            return;
        }

        const statusColor = {
            'Present-Day': '#16a34a',
            'Present-Night': '#1e40af',
            'Absent': '#dc2626',
            'Leave': '#d97706',
            'Weekly-Off': '#64748b'
        };

        document.getElementById('hist-tbody').innerHTML = records.map(r => {
            const color = statusColor[r.status] || '#64748b';
            const otDisplay = r.overtimeMinutes > 0
                ? `<span style="color:#7c3aed;font-weight:700;">${r.overtimeMinutes}</span>`
                : `<span style="color:var(--muted);">0</span>`;
            return `<tr>
                <td>${r.date}</td>
                <td><span style="color:${color};font-weight:600;">${r.status}</span></td>
                <td>${otDisplay}</td>
            </tr>`;
        }).join('');
    } catch (e) {
        document.getElementById('hist-tbody').innerHTML =
            '<tr><td colspan="3" style="text-align:center;padding:20px;color:#dc2626;">Error loading history.</td></tr>';
    }
}

function closeModal(id) {
    document.getElementById(id).classList.remove('open');
}

// Backdrop modal click listener
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', e => {
            if (e.target === overlay) overlay.classList.remove('open');
        });
    });
});