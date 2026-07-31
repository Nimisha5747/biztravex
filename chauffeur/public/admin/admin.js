document.addEventListener('DOMContentLoaded', function () {
  checkAdminSession();
});

async function checkAdminSession() {
  try {
    const res = await fetch('/api/admin/me');
    const data = await res.json();

    if (!data.loggedIn) {
      window.location.href = '/admin/login.html';
      return;
    }

    document.getElementById('adminNameChip').textContent = data.admin.name || data.admin.email;
    loadChauffeurs();
  } catch (err) {
    window.location.href = '/admin/login.html';
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
      opt.textContent = `${c.name} (${c.number})`;
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
    await fetch('/api/admin/logout', { method: 'POST' });
  } catch (err) {
    console.error('Logout error:', err);
  }
  window.location.href = '/admin/login.html';
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

    container.innerHTML = data.chauffeurs.map(c => `
      <div class="chauffeur-row">
        <div>
          <div class="chauffeur-row-name">${c.name}</div>
          <div class="chauffeur-row-number">${c.number}</div>
        </div>
        <button class="btn btn-danger" onclick="deleteChauffeur('${c._id}', '${c.name.replace(/'/g, "\\'")}')">Delete</button>
      </div>
    `).join('');
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