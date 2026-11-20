/* ======================================================================
   SmartFund – quản lý quỹ chung & bữa ăn
   Toàn bộ dữ liệu lưu trong localStorage, có thể Xuất/Nhập JSON
   tương thích với file backup của bản gốc (members / transactions / meals).
   ====================================================================== */

(function () {
  "use strict";

  /* ---------------------------------------------------------------- *
   *  CONSTANTS
   * ---------------------------------------------------------------- */
  const STORAGE_KEY = "smartfund_data_v1";
  const SYNC_PREFIX = "[Đồng bộ] Đóng quỹ từ chi túi: ";

  const CATEGORY_LABEL = { AnUong: "Ăn uống", Khac: "Khác", Thu: "Thu quỹ" };
  const WEEKDAYS = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
  const MONTH_NAMES_PAD = (n) => String(n).padStart(2, "0");

  /* ---------------------------------------------------------------- *
   *  UTILITIES
   * ---------------------------------------------------------------- */
  function uid(prefix) {
    return (
      prefix +
      "_" +
      Date.now().toString(36) +
      Math.random().toString(36).slice(2, 7)
    );
  }

  function num(v) {
    if (v === null || v === undefined || v === "") return 0;
    if (typeof v === "number") return v;
    const n = parseFloat(String(v).replace(/[^\d.-]/g, ""));
    return isNaN(n) ? 0 : n;
  }

  function fmtVND(n) {
    n = Math.round(num(n));
    return n.toLocaleString("vi-VN") + "đ";
  }

  function fmtVNDSigned(n) {
    n = Math.round(num(n));
    const s = Math.abs(n).toLocaleString("vi-VN") + "đ";
    return n < 0 ? "-" + s : s;
  }

  // Số tiền rút gọn cho nhãn trên biểu đồ (vd. 1.550.000 -> "1,55tr")
  function fmtVNDShort(n) {
    n = Math.round(num(n));
    const abs = Math.abs(n);
    let out;
    if (abs >= 1000000) {
      out = (n / 1000000).toLocaleString("vi-VN", { maximumFractionDigits: 2 }) + "tr";
    } else if (abs >= 1000) {
      out = Math.round(n / 1000).toLocaleString("vi-VN") + "k";
    } else {
      out = n.toLocaleString("vi-VN");
    }
    return out;
  }

  // Vẽ biểu đồ donut (SVG thuần, không phụ thuộc thư viện ngoài).
  // segments: [{label, value, color}]
  function donutSVG(segments, size) {
    size = size || 118;
    const sw = 20;
    const r = (size - sw) / 2;
    const cx = size / 2,
      cy = size / 2;
    const circ = 2 * Math.PI * r;
    const total = segments.reduce((s, x) => s + Math.max(0, x.value), 0);
    let offset = 0;
    let circles = "";
    if (total > 0) {
      segments.forEach((seg) => {
        if (seg.value <= 0) return;
        const dash = (seg.value / total) * circ;
        circles += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${seg.color}" stroke-width="${sw}" stroke-dasharray="${dash.toFixed(
          2
        )} ${(circ - dash).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(
          2
        )}"/>`;
        offset += dash;
      });
    }
    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" class="donut-svg">
      <g transform="rotate(-90 ${cx} ${cy})">
        <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--border)" stroke-width="${sw}"/>
        ${circles}
      </g>
      <text x="${cx}" y="${cy - 3}" text-anchor="middle" style="fill:var(--text);font-weight:800;font-size:14px;font-family:inherit">${esc(
      fmtVNDShort(total)
    )}</text>
      <text x="${cx}" y="${cy + 14}" text-anchor="middle" style="fill:var(--text-dim);font-size:9px;font-family:inherit">Tổng chi</text>
    </svg>`;
  }

  // Vẽ biểu đồ cột xu hướng chi tiêu theo tháng (SVG thuần).
  // data: [{label, total}], cột cuối (tháng đang xem) tô màu vàng nổi bật.
  function trendBarSVG(data) {
    const W = 320,
      H = 150,
      marginX = 12,
      topMargin = 24,
      bottomMargin = 22;
    const plotH = H - topMargin - bottomMargin;
    const maxVal = Math.max(1, ...data.map((d) => d.total));
    const slot = (W - marginX * 2) / Math.max(1, data.length);
    const barW = Math.min(36, slot * 0.55);
    let bars = "";
    data.forEach((d, i) => {
      const cx = marginX + slot * i + slot / 2;
      const h = (d.total / maxVal) * plotH;
      const y = topMargin + (plotH - h);
      const isLast = i === data.length - 1;
      const color = isLast ? "var(--gold)" : "var(--primary)";
      bars += `<rect x="${(cx - barW / 2).toFixed(1)}" y="${y.toFixed(
        1
      )}" width="${barW.toFixed(1)}" height="${Math.max(h, 0).toFixed(
        1
      )}" rx="5" fill="${color}"/>`;
      if (d.total > 0) {
        bars += `<text x="${cx.toFixed(
          1
        )}" y="${(y - 6).toFixed(
          1
        )}" text-anchor="middle" style="fill:var(--text);font-size:9px;font-weight:700;font-family:inherit">${esc(
          fmtVNDShort(d.total)
        )}</text>`;
      }
      bars += `<text x="${cx.toFixed(1)}" y="${(H - bottomMargin + 14).toFixed(
        1
      )}" text-anchor="middle" style="fill:var(--text-dim);font-size:9.5px;font-weight:600;font-family:inherit">${esc(
        d.label
      )}</text>`;
    });
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" class="trend-svg" preserveAspectRatio="none">
      <line x1="${marginX}" y1="${(H - bottomMargin).toFixed(1)}" x2="${
      W - marginX
    }" y2="${(H - bottomMargin).toFixed(
      1
    )}" stroke="var(--border)" stroke-width="1"/>
      ${bars}
    </svg>`;
  }

  function toDateStr(d) {
    if (typeof d === "string") return d.slice(0, 10);
    const y = d.getFullYear(),
      m = MONTH_NAMES_PAD(d.getMonth() + 1),
      day = MONTH_NAMES_PAD(d.getDate());
    return `${y}-${m}-${day}`;
  }

  function todayStr() {
    return toDateStr(new Date());
  }

  function fmtDateVN(dateStr) {
    if (!dateStr) return "";
    const [y, m, d] = dateStr.slice(0, 10).split("-");
    return `${d}/${m}/${y}`;
  }

  function fmtDateLong(dateStr) {
    const dt = new Date(dateStr + "T00:00:00");
    const wd = WEEKDAYS[dt.getDay()];
    return `${wd}, ${fmtDateVN(dateStr)}`;
  }

  function fmtMonthLabel(dateStr) {
    const [y, m] = dateStr.slice(0, 10).split("-");
    return `Tháng ${parseInt(m, 10)}/${y}`;
  }

  function esc(s) {
    return String(s ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        }[c])
    );
  }

  function initials(name) {
    const parts = String(name || "?").trim().split(/\s+/);
    const last = parts[parts.length - 1] || "?";
    return last.slice(0, 1).toUpperCase();
  }

  function debounce(fn, ms) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  /* ---------------------------------------------------------------- *
   *  DATA LAYER (localStorage + import/export compatible JSON)
   * ---------------------------------------------------------------- */
  const DB = {
    state: null,

    defaultState() {
      return { members: [], transactions: [], meals: {} };
    },

    load() {
      let raw = null;
      try {
        raw = localStorage.getItem(STORAGE_KEY);
      } catch (e) {}
      if (!raw) {
        this.state = this.defaultState();
        return this.state;
      }
      try {
        const parsed = JSON.parse(raw);
        this.state = this.normalizeImported(parsed);
      } catch (e) {
        this.state = this.defaultState();
      }
      return this.state;
    },

    save() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
      } catch (e) {
        console.error("Không lưu được dữ liệu", e);
        toast("⚠️ Không lưu được dữ liệu (bộ nhớ đầy?)");
      }
    },

    // Chuẩn hoá dữ liệu import (từ backup cũ hoặc file nhập) về cấu trúc nội bộ gọn:
    // transaction: {id, type, category, subType, amount, description, memberId, participants[], date, datetime, linkedId?}
    normalizeImported(parsed) {
      const state = this.defaultState();
      const members = Array.isArray(parsed.members) ? parsed.members : [];
      state.members = members
        .filter((m) => m && m.id)
        .map((m) => ({ id: m.id, name: m.name || "Chưa đặt tên" }));

      const txs = Array.isArray(parsed.transactions) ? parsed.transactions : [];
      state.transactions = txs
        .filter((t) => t && t.id)
        .map((t) => {
          const amount = t.amount !== undefined ? num(t.amount) : num(t.amt);
          const datetime = t.datetime || t.date || new Date().toISOString();
          const subTypeRaw = (t.subType || "").toString();
          const subType = subTypeRaw === "quy" ? "quy" : "tui"; // mặc định "túi" nếu thiếu
          return {
            id: t.id,
            type: t.type === "Thu" ? "Thu" : "Chi",
            category: t.category || "Khac",
            subType,
            amount,
            description: t.description || t.desc || "",
            memberId: t.memberId || t.mid || null,
            participants: Array.isArray(t.participants) ? t.participants : [],
            date: toDateStr(datetime),
            datetime,
            linkedId: t.linkedId || undefined,
          };
        });

      state.meals =
        parsed.meals && typeof parsed.meals === "object" ? parsed.meals : {};
      return state;
    },

    // Xuất ra đúng dạng tương thích với backup gốc
    exportObject() {
      const members = this.state.members.map((m) => ({ id: m.id, name: m.name }));
      const transactions = [];
      this.state.transactions.forEach((t) => {
        const base = {
          id: t.id,
          datetime: t.datetime,
          date: t.datetime,
          memberId: t.memberId,
          mid: t.memberId,
          description: t.description,
          desc: t.description,
          type: t.type,
          category: t.category,
          amount: t.amount,
          amt: String(t.amount),
          participants: t.participants || [],
          subType: t.subType,
        };
        if (t.linkedId) base.linkedId = t.linkedId;
        transactions.push(base);
      });
      return { members, transactions, meals: this.state.meals };
    },

    download() {
      const data = this.exportObject();
      const blob = new Blob([JSON.stringify(data, null, 0)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const stamp = todayStr().replace(/-/g, "");
      a.href = url;
      a.download = `SmartFund_Backup_${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    },

    reset() {
      this.state = this.defaultState();
      this.save();
    },

    // ---- Members ----
    addMember(name) {
      const m = { id: uid("m"), name: name.trim() };
      this.state.members.push(m);
      this.save();
      return m;
    },
    updateMember(id, name) {
      const m = this.state.members.find((x) => x.id === id);
      if (m) {
        m.name = name.trim();
        this.save();
      }
    },
    deleteMember(id) {
      this.state.members = this.state.members.filter((x) => x.id !== id);
      this.save();
    },
    getMember(id) {
      return this.state.members.find((x) => x.id === id);
    },
    memberName(id) {
      const m = this.getMember(id);
      return m ? m.name : "—";
    },

    // ---- Transactions (+ auto-sync túi -> quỹ) ----
    // payload: {type, category, subType, amount, description, memberId, participants, date}
    addTransaction(payload) {
      const id = uid("tx");
      const datetime = (payload.date || todayStr()) + "T" + nowTime();
      const tx = {
        id,
        type: payload.type,
        category: payload.category,
        subType: payload.subType,
        amount: num(payload.amount),
        description: payload.description.trim(),
        memberId: payload.memberId,
        participants: payload.participants || [],
        date: payload.date || todayStr(),
        datetime,
      };
      this.state.transactions.push(tx);
      if (tx.type === "Chi" && tx.subType === "tui") {
        this.createOrUpdateAutoSync(tx);
      }
      this.save();
      return tx;
    },

    updateTransaction(id, payload) {
      const tx = this.state.transactions.find((t) => t.id === id);
      if (!tx) return;
      Object.assign(tx, {
        type: payload.type,
        category: payload.category,
        subType: payload.subType,
        amount: num(payload.amount),
        description: payload.description.trim(),
        memberId: payload.memberId,
        participants: payload.participants || [],
        date: payload.date || tx.date,
      });
      tx.datetime = tx.date + "T" + (tx.datetime.split("T")[1] || nowTime());

      if (tx.type === "Chi" && tx.subType === "tui") {
        this.createOrUpdateAutoSync(tx);
      } else {
        this.removeAutoSync(tx.id);
      }
      this.save();
    },

    deleteTransaction(id) {
      this.removeAutoSync(id);
      this.state.transactions = this.state.transactions.filter(
        (t) => t.id !== id && t.linkedId !== id
      );
      this.save();
    },

    createOrUpdateAutoSync(tx) {
      let auto = this.state.transactions.find((t) => t.linkedId === tx.id);
      const desc = SYNC_PREFIX + tx.description;
      if (auto) {
        auto.amount = tx.amount;
        auto.description = desc;
        auto.date = tx.date;
        auto.datetime = tx.datetime;
        auto.memberId = tx.memberId;
      } else {
        auto = {
          id: uid("auto_tx"),
          type: "Thu",
          category: "Thu",
          subType: "quy",
          amount: tx.amount,
          description: desc,
          memberId: tx.memberId,
          participants: [],
          date: tx.date,
          datetime: tx.datetime,
          linkedId: tx.id,
        };
        this.state.transactions.push(auto);
      }
    },

    removeAutoSync(txId) {
      this.state.transactions = this.state.transactions.filter(
        (t) => t.linkedId !== txId
      );
    },

    // Giao dịch "chính" hiển thị trong danh sách (ẩn bản ghi đồng bộ tự động)
    visibleTransactions() {
      return this.state.transactions
        .filter((t) => !t.linkedId)
        .sort((a, b) => (a.datetime < b.datetime ? 1 : -1));
    },

    // ---- Quỹ balance & tổng hợp ----
    // Số dư quỹ = tiền đã đóng quỹ thủ công (Thu, không tính bản ghi đồng bộ) trừ ĐI
    // tiền đã chi TRỰC TIẾP từ quỹ (subType "quy").
    // Chi tiêu cá nhân (chi từ túi, subType "tui") KHÔNG được trừ ở đây, vì mỗi khoản
    // chi túi luôn đi kèm đúng một khoản Thu đồng bộ cùng số tiền (xem createOrUpdateAutoSync) —
    // hai khoản này luôn triệt tiêu nhau vì tiền chi túi chưa bao giờ thực sự nằm trong quỹ.
    // Trừ cả chi túi lẫn không cộng lại khoản đồng bộ sẽ làm số dư bị trừ hai lần (sai).
    fundBalance() {
      let thuManual = 0,
        chiQuy = 0;
      this.state.transactions.forEach((t) => {
        if (t.type === "Thu" && !t.linkedId) thuManual += t.amount;
        else if (t.type === "Chi" && t.subType === "quy") chiQuy += t.amount;
      });
      return thuManual - chiQuy;
    },

    totals() {
      let thuDues = 0,
        thuSync = 0,
        chiQuy = 0,
        chiTuiAn = 0,
        chiTuiKhac = 0;
      this.state.transactions.forEach((t) => {
        if (t.type === "Thu") {
          if (t.linkedId) thuSync += t.amount;
          else thuDues += t.amount;
        } else if (t.type === "Chi") {
          if (t.subType === "quy") chiQuy += t.amount;
          else if (t.category === "AnUong") chiTuiAn += t.amount;
          else chiTuiKhac += t.amount;
        }
      });
      return { thuDues, thuSync, chiQuy, chiTuiAn, chiTuiKhac };
    },

    // ---- Meals ----
    mealKey(dateStr, memberId) {
      return `${dateStr}_${memberId}`;
    },
    getMeal(dateStr, memberId) {
      return (
        this.state.meals[this.mealKey(dateStr, memberId)] || {
          breakfast: false,
          lunch: false,
          dinner: false,
        }
      );
    },
    toggleMeal(dateStr, memberId, slot) {
      const key = this.mealKey(dateStr, memberId);
      const cur = this.state.meals[key] || {
        breakfast: false,
        lunch: false,
        dinner: false,
      };
      cur[slot] = !cur[slot];
      this.state.meals[key] = cur;
      this.save();
      return cur[slot];
    },
    // "Sổ cái" của từng thành viên trong một khoảng ngày (toàn thời gian hoặc 1 tháng):
    //   - Đã góp   = tiền họ đã đóng quỹ thủ công (Thu, không tính bản ghi đồng bộ)
    //                CỘNG tiền họ đã tự ứng ra chi túi (vì đó cũng là tiền họ bỏ ra
    //                cho cả nhóm, chỉ là trả thẳng thay vì nộp vào quỹ trước).
    //   - Tiền ăn  = phần ăn uống (danh mục AnUong) họ đã "ăn", tính THEO TỪNG NGÀY:
    //                giá/bữa của ngày đó = tổng chi AnUong ngày đó / tổng số bữa cả
    //                nhóm ăn ngày đó; rồi nhân với số bữa CHÍNH người đó ăn ngày đó.
    //                (Không dùng giá bình quân cả kỳ, vì ngày đắt/rẻ khác nhau nên
    //                phải tính đúng ngày để công bằng.)
    //   - Chi khác = phần chi phí "Khác" (ga, đồ dùng chung...), MỖI GIAO DỊCH chia
    //                đều cho đúng những người có tên trong participants của giao
    //                dịch đó. Nếu giao dịch không ghi participants, mặc định chia
    //                đều cho tất cả thành viên (không có cách nào xác định ai dùng).
    //   - Đã dùng  = Tiền ăn + Chi khác
    //   - Còn lại  = Đã góp - Đã dùng  (dương = còn dư, âm = đang nợ quỹ)
    // Luôn tính lại trực tiếp từ transactions/meals -> cập nhật tức thời mỗi khi render.
    memberLedger(startStr, endStr) {
      const members = this.state.members;
      const allIds = members.map((m) => m.id);

      // ----- Tiền ăn: phân bổ theo giá/bữa của TỪNG NGÀY -----
      const dayAnUong = {}; // date -> tổng chi AnUong ngày đó
      this.state.transactions.forEach((t) => {
        if (t.type !== "Chi" || t.category !== "AnUong") return;
        if (t.date < startStr || t.date > endStr) return;
        dayAnUong[t.date] = (dayAnUong[t.date] || 0) + t.amount;
      });

      const dayMemberMeals = {}; // date -> memberId -> số bữa
      const dayTotalMeals = {}; // date -> tổng số bữa cả nhóm
      Object.keys(this.state.meals).forEach((key) => {
        const idx = key.lastIndexOf("_");
        const date = key.slice(0, idx).slice(0, 10);
        const memberId = key.slice(idx + 1);
        if (date < startStr || date > endStr) return;
        if (allIds.indexOf(memberId) === -1) return;
        const m = this.state.meals[key];
        let c = 0;
        ["breakfast", "lunch", "dinner"].forEach((slot) => {
          if (m[slot]) c++;
        });
        if (c === 0) return;
        dayMemberMeals[date] = dayMemberMeals[date] || {};
        dayMemberMeals[date][memberId] =
          (dayMemberMeals[date][memberId] || 0) + c;
        dayTotalMeals[date] = (dayTotalMeals[date] || 0) + c;
      });

      const tienAn = {};
      const mealCount = {};
      members.forEach((m) => {
        tienAn[m.id] = 0;
        mealCount[m.id] = 0;
      });
      let anUongSpend = 0,
        totalSlots = 0;
      Object.keys(dayAnUong).forEach((date) => {
        const spend = dayAnUong[date];
        anUongSpend += spend;
        const slotsThatDay = dayTotalMeals[date] || 0;
        if (slotsThatDay === 0) return; // không ai check-in ngày đó, không phân bổ được
        const rate = spend / slotsThatDay;
        const mm = dayMemberMeals[date] || {};
        Object.keys(mm).forEach((mid) => {
          if (!(mid in tienAn)) return;
          tienAn[mid] += mm[mid] * rate;
        });
      });
      Object.keys(dayTotalMeals).forEach((date) => {
        totalSlots += dayTotalMeals[date];
        const mm = dayMemberMeals[date] || {};
        Object.keys(mm).forEach((mid) => {
          if (mid in mealCount) mealCount[mid] += mm[mid];
        });
      });

      // ----- Chi phí Khác: chia theo participants của TỪNG giao dịch -----
      const chiKhac = {};
      members.forEach((m) => (chiKhac[m.id] = 0));
      let khacSpend = 0;
      this.state.transactions.forEach((t) => {
        if (t.type !== "Chi" || t.category === "AnUong") return;
        if (t.date < startStr || t.date > endStr) return;
        khacSpend += t.amount;
        const parts =
          t.participants && t.participants.length ? t.participants : allIds;
        const validParts = parts.filter((id) => id in chiKhac);
        const share = validParts.length
          ? t.amount / validParts.length
          : 0;
        validParts.forEach((id) => {
          chiKhac[id] += share;
        });
      });

      // ----- Đã góp: Thu thủ công + tự ứng chi túi -----
      const contributed = {};
      members.forEach((m) => (contributed[m.id] = 0));
      this.state.transactions.forEach((t) => {
        if (t.date < startStr || t.date > endStr) return;
        if (t.type === "Thu" && !t.linkedId) {
          contributed[t.memberId] = (contributed[t.memberId] || 0) + t.amount;
        } else if (t.type === "Chi" && t.subType === "tui") {
          contributed[t.memberId] = (contributed[t.memberId] || 0) + t.amount;
        }
      });

      const perMember = {};
      members.forEach((m) => {
        const used = (tienAn[m.id] || 0) + (chiKhac[m.id] || 0);
        const paid = contributed[m.id] || 0;
        perMember[m.id] = {
          contributed: paid,
          used,
          tienAn: tienAn[m.id] || 0,
          chiKhac: chiKhac[m.id] || 0,
          remaining: paid - used,
          meals: mealCount[m.id] || 0,
        };
      });

      const costPerMeal = totalSlots > 0 ? anUongSpend / totalSlots : 0;
      return { perMember, costPerMeal, totalSlots, anUongSpend, khacSpend };
    },

    mealCountInRange(startStr, endStr) {
      // trả về {memberId: {breakfast,lunch,dinner,total}}
      const out = {};
      this.state.members.forEach((m) => {
        out[m.id] = { breakfast: 0, lunch: 0, dinner: 0, total: 0 };
      });
      Object.keys(this.state.meals).forEach((key) => {
        const idx = key.lastIndexOf("_");
        const date = key.slice(0, idx).slice(0, 10);
        const memberId = key.slice(idx + 1);
        if (date < startStr || date > endStr) return;
        if (!out[memberId]) return;
        const m = this.state.meals[key];
        ["breakfast", "lunch", "dinner"].forEach((slot) => {
          if (m[slot]) {
            out[memberId][slot]++;
            out[memberId].total++;
          }
        });
      });
      return out;
    },

    // Thống kê chi tiết từng danh mục (AnUong, Khac) trong 1 khoảng ngày:
    // tổng tiền, số giao dịch, trung bình/giao dịch. Dùng cho biểu đồ + bảng chi tiết.
    categoryDetail(startStr, endStr) {
      const out = {
        AnUong: { total: 0, count: 0 },
        Khac: { total: 0, count: 0 },
      };
      this.state.transactions.forEach((t) => {
        if (t.type !== "Chi") return;
        if (t.date < startStr || t.date > endStr) return;
        const key = t.category === "AnUong" ? "AnUong" : "Khac";
        out[key].total += t.amount;
        out[key].count += 1;
      });
      Object.keys(out).forEach((k) => {
        out[k].avg = out[k].count ? out[k].total / out[k].count : 0;
      });
      out.grandTotal = out.AnUong.total + out.Khac.total;
      return out;
    },

    // Chuỗi tổng chi tiêu (AnUong + Khac, mọi subType) theo từng tháng,
    // `count` tháng gần nhất tính đến và bao gồm tháng endYm (YYYY-MM).
    // Dùng để vẽ biểu đồ cột xu hướng chi tiêu.
    monthlySpendSeries(endYm, count) {
      const [ey, em] = endYm.split("-").map(Number);
      const months = [];
      for (let i = count - 1; i >= 0; i--) {
        const d = new Date(ey, em - 1 - i, 1);
        const ym = `${d.getFullYear()}-${MONTH_NAMES_PAD(d.getMonth() + 1)}`;
        months.push({ ym, y: d.getFullYear(), m: d.getMonth() + 1, total: 0 });
      }
      const idxByYm = {};
      months.forEach((mo, i) => (idxByYm[mo.ym] = i));
      this.state.transactions.forEach((t) => {
        if (t.type !== "Chi") return;
        const ym = t.date.slice(0, 7);
        if (!(ym in idxByYm)) return;
        months[idxByYm[ym]].total += t.amount;
      });
      months.forEach((mo) => {
        mo.label = `T${mo.m}`;
      });
      return months;
    },
  };

  function nowTime() {
    const d = new Date();
    return `${MONTH_NAMES_PAD(d.getHours())}:${MONTH_NAMES_PAD(d.getMinutes())}`;
  }

  /* ---------------------------------------------------------------- *
   *  UI STATE
   * ---------------------------------------------------------------- */
  const UI = {
    tab: "dashboard",
    mealDate: todayStr(),
    reportMonth: todayStr().slice(0, 7), // YYYY-MM, dùng chung cho tab Thành viên & Báo cáo
    txFilter: "all", // all | quy | tui
    memberScope: "all", // all | month -> phạm vi tính "còn lại / đã dùng" ở tab Thành viên
  };

  const EPOCH_START = "2000-01-01";
  const EPOCH_END = "2100-12-31";

  function shiftMonth(ym, delta) {
    const [y, m] = ym.split("-").map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return `${d.getFullYear()}-${MONTH_NAMES_PAD(d.getMonth() + 1)}`;
  }

  /* ---------------------------------------------------------------- *
   *  TOAST
   * ---------------------------------------------------------------- */
  let toastTimer = null;
  function toast(msg) {
    const root = document.getElementById("toastRoot");
    root.innerHTML = `<div class="toast">${esc(msg)}</div>`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      root.innerHTML = "";
    }, 2200);
  }

  /* ---------------------------------------------------------------- *
   *  MODAL
   * ---------------------------------------------------------------- */
  function openModal(title, bodyHtml, { onMount, wide } = {}) {
    const root = document.getElementById("modalRoot");
    root.innerHTML = `
      <div class="modal-overlay" id="modalOverlay">
        <div class="modal-sheet" role="dialog" aria-modal="true">
          <div class="modal-header">
            <h3>${esc(title)}</h3>
            <button class="modal-close" id="modalCloseBtn">✕</button>
          </div>
          <div id="modalBody">${bodyHtml}</div>
        </div>
      </div>`;
    document.getElementById("modalCloseBtn").onclick = closeModal;
    document.getElementById("modalOverlay").addEventListener("click", (e) => {
      if (e.target.id === "modalOverlay") closeModal();
    });
    if (onMount) onMount(document.getElementById("modalBody"));
  }
  function closeModal() {
    document.getElementById("modalRoot").innerHTML = "";
  }

  /* ---------------------------------------------------------------- *
   *  ROUTER / RENDER
   * ---------------------------------------------------------------- */
  function setTab(tab) {
    UI.tab = tab;
    document.querySelectorAll(".tab-btn").forEach((b) => {
      b.classList.toggle("active", b.dataset.tab === tab);
    });
    render();
  }

  function render() {
    const view = document.getElementById("view");
    removeFab();
    switch (UI.tab) {
      case "dashboard":
        view.innerHTML = renderDashboard();
        break;
      case "transactions":
        view.innerHTML = renderTransactions();
        addFab("➕", () => openTransactionModal());
        wireTransactionsEvents();
        break;
      case "meals":
        view.innerHTML = renderMeals();
        wireMealsEvents();
        break;
      case "members":
        view.innerHTML = renderMembers();
        addFab("➕", () => openMemberModal());
        wireMembersEvents();
        break;
      case "reports":
        view.innerHTML = renderReports();
        wireReportsEvents();
        break;
    }
  }

  function addFab(icon, onClick) {
    removeFab();
    const btn = document.createElement("button");
    btn.className = "fab";
    btn.id = "fabBtn";
    btn.innerHTML = icon;
    btn.onclick = onClick;
    document.getElementById("app").appendChild(btn);
  }
  function removeFab() {
    const old = document.getElementById("fabBtn");
    if (old) old.remove();
  }

  /* ================= DASHBOARD ================= */
  function renderDashboard() {
    const balance = DB.fundBalance();
    const t = DB.totals();
    const recents = DB.visibleTransactions().slice(0, 6);
    const now = todayStr();
    const monthStart = now.slice(0, 8) + "01";
    const spendThisMonth = DB.state.transactions
      .filter(
        (tx) =>
          tx.type === "Chi" &&
          tx.subType === "tui" &&
          tx.date >= monthStart &&
          tx.date <= now
      )
      .reduce((s, tx) => s + tx.amount, 0);

    return `
      <div class="stat-grid">
        <div class="stat-card wide ${balance >= 0 ? "pos" : "neg"}">
          <div class="label">Số dư quỹ hiện tại</div>
          <div class="value">${fmtVNDSigned(balance)}</div>
          <div class="hint">Đã đóng ${fmtVND(
            t.thuDues
          )} − chi trực tiếp từ quỹ ${fmtVND(t.chiQuy)}</div>
        </div>
        <div class="stat-card">
          <div class="label">Đã đóng quỹ</div>
          <div class="value">${fmtVND(t.thuDues)}</div>
        </div>
        <div class="stat-card">
          <div class="label">Chi trực tiếp từ quỹ</div>
          <div class="value">${fmtVND(t.chiQuy)}</div>
        </div>
        <div class="stat-card wide">
          <div class="label">Chi tiêu cá nhân (đi chợ) tháng này</div>
          <div class="value">${fmtVND(spendThisMonth)}</div>
        </div>
      </div>

      <div class="section-title">Giao dịch gần đây</div>
      <div class="card">
        ${
          recents.length
            ? recents.map(txListItemHtml).join("")
            : emptyState("Chưa có giao dịch nào")
        }
      </div>
      ${DB.state.members.length === 0 ? welcomeCard() : ""}
    `;
  }

  function welcomeCard() {
    return `
      <div class="card" style="text-align:center">
        <div style="font-size:34px;margin-bottom:8px">👋</div>
        <div style="font-weight:700;margin-bottom:6px">Chào mừng đến SmartFund</div>
        <div class="text-dim text-sm" style="margin-bottom:14px">Bắt đầu bằng cách thêm thành viên trong nhóm của bạn</div>
        <button class="btn primary" id="btnGoMembers">Thêm thành viên</button>
      </div>`;
  }

  /* ================= MEMBERS ================= */
  function renderMembers() {
    const members = DB.state.members;
    const isMonth = UI.memberScope === "month";
    const { start, end } = isMonth
      ? monthRange(UI.reportMonth)
      : { start: EPOCH_START, end: EPOCH_END };
    const ledger = DB.memberLedger(start, end);

    return `
      <div class="segmented" id="memScopeSeg">
        <button data-s="all" class="${!isMonth ? "active" : ""}">Toàn thời gian</button>
        <button data-s="month" class="${isMonth ? "active" : ""}">Theo tháng</button>
      </div>
      ${
        isMonth
          ? `<div class="month-switch">
               <button class="icon-btn" id="memPrevMonth" style="color:var(--primary-dark);background:var(--primary-dim)">‹</button>
               <div class="month-label">${fmtMonthLabel(start)}</div>
               <button class="icon-btn" id="memNextMonth" style="color:var(--primary-dark);background:var(--primary-dim)">›</button>
             </div>`
          : ""
      }
      <div class="hint" style="margin:-4px 2px 14px">Đã góp = đã đóng quỹ + đã tự ứng tiền túi đi chợ. Tiền ăn tính theo giá/bữa của từng ngày (giá/bữa trung bình ≈ ${fmtVND(
        ledger.costPerMeal
      )}). Chi phí Khác chia cho đúng người tham gia mỗi giao dịch.</div>
      <div class="section-title">Thành viên (${members.length})</div>
      <div class="card">
        ${
          members.length
            ? members
                .map((m) => {
                  const s = ledger.perMember[m.id] || {
                    contributed: 0,
                    used: 0,
                    remaining: 0,
                    meals: 0,
                  };
                  const remPos = s.remaining >= 0;
                  return `
          <div class="list-item" data-member="${m.id}" style="display:block">
            <div style="display:flex;align-items:center;gap:12px">
              <div class="avatar">${esc(initials(m.name))}</div>
              <div class="li-main">
                <div class="li-title">${esc(m.name)}</div>
                <div class="li-sub">${s.meals} bữa đã ăn</div>
              </div>
              <button class="link-btn" data-edit-member="${m.id}">Sửa</button>
            </div>
            <div class="member-money-row">
              <div class="mm-item">
                <div class="mm-label">Đã góp</div>
                <div class="mm-value">${fmtVND(s.contributed)}</div>
              </div>
              <div class="mm-item">
                <div class="mm-label">Đã dùng</div>
                <div class="mm-value">${fmtVND(s.used)}</div>
              </div>
              <div class="mm-item">
                <div class="mm-label">Còn lại</div>
                <div class="mm-value ${remPos ? "pos" : "neg"}">${fmtVNDSigned(
                    s.remaining
                  )}</div>
              </div>
            </div>
          </div>`;
                })
                .join("")
            : emptyState("Chưa có thành viên nào. Nhấn + để thêm.")
        }
      </div>
    `;
  }

  function wireMembersEvents() {
    document.querySelectorAll("[data-edit-member]").forEach((btn) => {
      btn.onclick = () =>
        openMemberModal(DB.getMember(btn.dataset.editMember));
    });
    const goBtn = document.getElementById("btnGoMembers");
    if (goBtn) goBtn.onclick = () => setTab("members");
    document.querySelectorAll("#memScopeSeg button").forEach((b) => {
      b.onclick = () => {
        UI.memberScope = b.dataset.s;
        render();
      };
    });
    const prevBtn = document.getElementById("memPrevMonth");
    const nextBtn = document.getElementById("memNextMonth");
    if (prevBtn)
      prevBtn.onclick = () => {
        UI.reportMonth = shiftMonth(UI.reportMonth, -1);
        render();
      };
    if (nextBtn)
      nextBtn.onclick = () => {
        UI.reportMonth = shiftMonth(UI.reportMonth, 1);
        render();
      };
  }

  function openMemberModal(member) {
    const isEdit = !!member;
    openModal(
      isEdit ? "Sửa thành viên" : "Thêm thành viên",
      `
        <div class="form-group">
          <label class="form-label">Tên thành viên</label>
          <input class="form-input" id="memberNameInput" maxlength="40" placeholder="VD: Thắng" value="${
            isEdit ? esc(member.name) : ""
          }">
        </div>
        <div class="modal-actions">
          ${isEdit ? `<button class="btn danger" id="memberDeleteBtn">Xoá</button>` : ""}
          <button class="btn primary" id="memberSaveBtn">${
            isEdit ? "Lưu" : "Thêm"
          }</button>
        </div>
      `,
      {
        onMount: () => {
          const input = document.getElementById("memberNameInput");
          input.focus();
          document.getElementById("memberSaveBtn").onclick = () => {
            const name = input.value.trim();
            if (!name) {
              toast("Vui lòng nhập tên");
              return;
            }
            if (isEdit) DB.updateMember(member.id, name);
            else DB.addMember(name);
            closeModal();
            render();
            toast(isEdit ? "Đã lưu" : "Đã thêm thành viên");
          };
          const delBtn = document.getElementById("memberDeleteBtn");
          if (delBtn)
            delBtn.onclick = () => {
              const usedCount = DB.state.transactions.filter(
                (t) => t.memberId === member.id
              ).length;
              const msg = usedCount
                ? `Thành viên này có ${usedCount} giao dịch liên quan. Vẫn xoá?`
                : "Xoá thành viên này?";
              if (confirm(msg)) {
                DB.deleteMember(member.id);
                closeModal();
                render();
                toast("Đã xoá thành viên");
              }
            };
        },
      }
    );
  }

  /* ================= TRANSACTIONS ================= */
  function txListItemHtml(tx) {
    const sign = tx.type === "Thu" ? "thu" : "chi";
    const amtStr = (tx.type === "Thu" ? "+" : "-") + fmtVND(tx.amount);
    const subTag =
      tx.subType === "quy"
        ? `<span class="tag quy">Quỹ</span>`
        : `<span class="tag tui">Túi</span>`;
    const catTag =
      tx.category === "AnUong"
        ? `<span class="tag an">Ăn uống</span>`
        : tx.category === "Thu"
        ? ""
        : `<span class="tag khac">Khác</span>`;
    return `
      <div class="list-item" data-tx="${tx.id}">
        <div class="avatar">${esc(initials(DB.memberName(tx.memberId)))}</div>
        <div class="li-main">
          <div class="li-title">${esc(tx.description || "(không có mô tả)")}</div>
          <div class="li-sub">${subTag}${catTag}${esc(
      DB.memberName(tx.memberId)
    )} · ${fmtDateVN(tx.date)}</div>
        </div>
        <div class="li-amt ${sign}">${amtStr}</div>
      </div>`;
  }

  function renderTransactions() {
    let txs = DB.visibleTransactions();
    if (UI.txFilter === "quy")
      txs = txs.filter((t) => t.subType === "quy" && !t.linkedId);
    if (UI.txFilter === "tui") txs = txs.filter((t) => t.subType === "tui");

    const balance = DB.fundBalance();
    return `
      <div class="card" style="margin-bottom:14px">
        <div class="card-row">
          <div>
            <div class="text-dim text-sm">Số dư quỹ</div>
            <div style="font-weight:800;font-size:18px;color:${
              balance >= 0 ? "var(--green)" : "var(--red)"
            }">${fmtVNDSigned(balance)}</div>
          </div>
          <button class="btn" id="btnExportQuick">⚙️ Sao lưu</button>
        </div>
      </div>
      <div class="segmented" id="txFilterSeg">
        <button data-f="all" class="${UI.txFilter === "all" ? "active" : ""}">Tất cả</button>
        <button data-f="quy" class="${UI.txFilter === "quy" ? "active" : ""}">Quỹ chung</button>
        <button data-f="tui" class="${UI.txFilter === "tui" ? "active" : ""}">Chi túi cá nhân</button>
      </div>
      <div class="card">
        ${
          txs.length
            ? txs.map(txListItemHtml).join("")
            : emptyState("Không có giao dịch nào")
        }
      </div>
    `;
  }

  function wireTransactionsEvents() {
    document.querySelectorAll("#txFilterSeg button").forEach((b) => {
      b.onclick = () => {
        UI.txFilter = b.dataset.f;
        render();
      };
    });
    document.querySelectorAll("[data-tx]").forEach((el) => {
      el.onclick = () => {
        const tx = DB.state.transactions.find((t) => t.id === el.dataset.tx);
        if (tx) openTransactionModal(tx);
      };
    });
    const expBtn = document.getElementById("btnExportQuick");
    if (expBtn) expBtn.onclick = openSettingsModal;
  }

  function openTransactionModal(tx) {
    const isEdit = !!tx;
    const members = DB.state.members;
    if (!isEdit && members.length === 0) {
      toast("Hãy thêm thành viên trước");
      setTab("members");
      return;
    }
    const type = tx ? tx.type : "Chi";
    const subType = tx ? tx.subType : "tui";
    const category = tx ? tx.category : "AnUong";
    const memberId = tx ? tx.memberId : members[0].id;
    const participants = tx ? tx.participants : members.map((m) => m.id);

    const body = `
      <div class="form-group">
        <label class="form-label">Loại giao dịch</label>
        <div class="chip-group" id="typeChips">
          <div class="chip ${type === "Chi" ? "active chi" : ""}" data-v="Chi">Chi</div>
          <div class="chip ${type === "Thu" ? "active thu" : ""}" data-v="Thu">Thu</div>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Nguồn tiền</label>
        <div class="chip-group" id="subTypeChips">
          <div class="chip ${subType === "tui" ? "active" : ""}" data-v="tui">Chi từ túi cá nhân</div>
          <div class="chip ${subType === "quy" ? "active" : ""}" data-v="quy">Trực tiếp từ quỹ</div>
        </div>
        <div class="hint" id="subTypeHint"></div>
      </div>
      <div class="form-group">
        <label class="form-label">Danh mục</label>
        <div class="chip-group" id="catChips">
          <div class="chip ${category === "AnUong" ? "active" : ""}" data-v="AnUong">Ăn uống / đi chợ</div>
          <div class="chip ${category === "Khac" ? "active" : ""}" data-v="Khac">Khác</div>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Số tiền (đ)</label>
        <input class="form-input" id="amountInput" inputmode="numeric" placeholder="0" value="${
          tx ? tx.amount : ""
        }">
      </div>
      <div class="form-group">
        <label class="form-label">Mô tả</label>
        <input class="form-input" id="descInput" maxlength="120" placeholder="VD: Đi chợ, Đóng quỹ tháng..." value="${
          tx ? esc(tx.description) : ""
        }">
      </div>
      <div class="form-group">
        <label class="form-label">Người thực hiện</label>
        <select class="form-select" id="memberSelect">
          ${members
            .map(
              (m) =>
                `<option value="${m.id}" ${
                  m.id === memberId ? "selected" : ""
                }>${esc(m.name)}</option>`
            )
            .join("")}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Ngày</label>
        <input class="form-input" type="date" id="dateInput" value="${
          tx ? tx.date : todayStr()
        }">
      </div>
      <div class="form-group">
        <label class="form-label">Chia cho (nếu dùng chung)</label>
        <div class="member-pick" id="participantPick">
          ${members
            .map(
              (m) => `
            <div class="chip ${
              participants.includes(m.id) ? "active" : ""
            }" data-member="${m.id}">${esc(m.name)}</div>`
            )
            .join("")}
        </div>
      </div>
      <div class="modal-actions">
        ${isEdit ? `<button class="btn danger" id="txDeleteBtn">Xoá</button>` : ""}
        <button class="btn primary" id="txSaveBtn">${
          isEdit ? "Lưu" : "Thêm"
        }</button>
      </div>
    `;

    openModal(isEdit ? "Sửa giao dịch" : "Thêm giao dịch", body, {
      onMount: (root) => {
        let curType = type,
          curSubType = subType,
          curCategory = category;
        const selParticipants = new Set(participants);

        function updateHint() {
          const hint = document.getElementById("subTypeHint");
          if (curType === "Chi" && curSubType === "tui") {
            hint.textContent =
              "Số tiền này sẽ tự động được ghi nhận là một khoản Thu vào quỹ chung (đồng bộ).";
          } else {
            hint.textContent = "";
          }
        }
        updateHint();

        root.querySelectorAll("#typeChips .chip").forEach((c) => {
          c.onclick = () => {
            curType = c.dataset.v;
            root
              .querySelectorAll("#typeChips .chip")
              .forEach((x) =>
                x.classList.remove("active", "chi", "thu")
              );
            c.classList.add("active", curType === "Chi" ? "chi" : "thu");
            updateHint();
          };
        });
        root.querySelectorAll("#subTypeChips .chip").forEach((c) => {
          c.onclick = () => {
            curSubType = c.dataset.v;
            root
              .querySelectorAll("#subTypeChips .chip")
              .forEach((x) => x.classList.remove("active"));
            c.classList.add("active");
            updateHint();
          };
        });
        root.querySelectorAll("#catChips .chip").forEach((c) => {
          c.onclick = () => {
            curCategory = c.dataset.v;
            root
              .querySelectorAll("#catChips .chip")
              .forEach((x) => x.classList.remove("active"));
            c.classList.add("active");
          };
        });
        root.querySelectorAll("#participantPick .chip").forEach((c) => {
          c.onclick = () => {
            const id = c.dataset.member;
            if (selParticipants.has(id)) {
              selParticipants.delete(id);
              c.classList.remove("active");
            } else {
              selParticipants.add(id);
              c.classList.add("active");
            }
          };
        });

        document.getElementById("txSaveBtn").onclick = () => {
          const amount = num(document.getElementById("amountInput").value);
          const description = document.getElementById("descInput").value.trim();
          const memberIdVal = document.getElementById("memberSelect").value;
          const date = document.getElementById("dateInput").value || todayStr();
          if (!amount || amount <= 0) {
            toast("Vui lòng nhập số tiền hợp lệ");
            return;
          }
          if (!description) {
            toast("Vui lòng nhập mô tả");
            return;
          }
          const payload = {
            type: curType,
            subType: curSubType,
            category: curCategory,
            amount,
            description,
            memberId: memberIdVal,
            participants: Array.from(selParticipants),
            date,
          };
          if (isEdit) DB.updateTransaction(tx.id, payload);
          else DB.addTransaction(payload);
          closeModal();
          render();
          toast(isEdit ? "Đã lưu giao dịch" : "Đã thêm giao dịch");
        };

        const delBtn = document.getElementById("txDeleteBtn");
        if (delBtn)
          delBtn.onclick = () => {
            if (confirm("Xoá giao dịch này?")) {
              DB.deleteTransaction(tx.id);
              closeModal();
              render();
              toast("Đã xoá giao dịch");
            }
          };
      },
    });
  }

  /* ================= MEALS ================= */
  function shiftDate(dateStr, delta) {
    const d = new Date(dateStr + "T00:00:00");
    d.setDate(d.getDate() + delta);
    return toDateStr(d);
  }

  function renderMeals() {
    const members = DB.state.members;
    const date = UI.mealDate;
    if (members.length === 0) {
      return `<div class="card">${emptyState(
        "Hãy thêm thành viên trước khi ghi nhận bữa ăn."
      )}</div>`;
    }
    const rows = members
      .map((m) => {
        const meal = DB.getMeal(date, m.id);
        return `
        <tr data-member="${m.id}">
          <td>
            <div style="display:flex;align-items:center;gap:8px">
              <div class="avatar" style="width:28px;height:28px;font-size:12px">${esc(
                initials(m.name)
              )}</div>
              <span class="meal-name">${esc(m.name)}</span>
            </div>
          </td>
          <td><div class="meal-check ${
            meal.breakfast ? "on" : ""
          }" data-slot="breakfast">✓</div></td>
          <td><div class="meal-check ${
            meal.lunch ? "on" : ""
          }" data-slot="lunch">✓</div></td>
          <td><div class="meal-check ${
            meal.dinner ? "on" : ""
          }" data-slot="dinner">✓</div></td>
        </tr>`;
      })
      .join("");

    const yesterday = shiftDate(todayStr(), -1);
    const tomorrow = shiftDate(todayStr(), 1);
    const isToday = date === todayStr();

    return `
      <div class="day-nav">
        <button id="mealPrev">‹</button>
        <div class="day-label-wrap">
          <div class="day-label">${
            isToday ? `<span class="today-badge">HÔM NAY</span>` : ""
          }${fmtDateLong(date)}</div>
          <input type="date" class="day-date-native" id="mealDateInput" value="${date}">
        </div>
        <button id="mealNext">›</button>
      </div>
      <div class="quick-chips">
        <div class="chip ${
          date === yesterday ? "active" : ""
        }" data-qd="${yesterday}">Hôm qua</div>
        <div class="chip ${
          isToday ? "active" : ""
        }" data-qd="${todayStr()}">Hôm nay</div>
        <div class="chip ${
          date === tomorrow ? "active" : ""
        }" data-qd="${tomorrow}">Ngày mai</div>
      </div>
      <div class="card">
        <table class="meal-table">
          <thead>
            <tr><th style="text-align:left">Thành viên</th><th>🌅 Sáng</th><th>☀️ Trưa</th><th>🌙 Tối</th></tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  }

  function wireMealsEvents() {
    document.getElementById("mealPrev").onclick = () => {
      UI.mealDate = shiftDate(UI.mealDate, -1);
      render();
    };
    document.getElementById("mealNext").onclick = () => {
      UI.mealDate = shiftDate(UI.mealDate, 1);
      render();
    };
    const dateInput = document.getElementById("mealDateInput");
    if (dateInput) {
      // Chạm vào nhãn ngày sẽ mở lịch chọn nhanh (native date picker) để nhảy tới
      // bất kỳ ngày nào chỉ trong 1 thao tác, thay vì phải bấm ‹ › nhiều lần.
      dateInput.onclick = () => {
        if (dateInput.showPicker) {
          try {
            dateInput.showPicker();
          } catch (e) {}
        }
      };
      dateInput.onchange = () => {
        if (dateInput.value) {
          UI.mealDate = dateInput.value;
          render();
        }
      };
    }
    document.querySelectorAll("[data-qd]").forEach((chip) => {
      chip.onclick = () => {
        UI.mealDate = chip.dataset.qd;
        render();
      };
    });
    document.querySelectorAll(".meal-check").forEach((el) => {
      el.onclick = () => {
        const row = el.closest("tr");
        const memberId = row.dataset.member;
        const slot = el.dataset.slot;
        const on = DB.toggleMeal(UI.mealDate, memberId, slot);
        el.classList.toggle("on", on);
      };
    });
  }

  /* ================= REPORTS ================= */
  function monthRange(ym) {
    const [y, m] = ym.split("-").map(Number);
    const start = `${y}-${MONTH_NAMES_PAD(m)}-01`;
    const lastDay = new Date(y, m, 0).getDate();
    const end = `${y}-${MONTH_NAMES_PAD(m)}-${MONTH_NAMES_PAD(lastDay)}`;
    return { start, end };
  }

  function renderReports() {
    const { start, end } = monthRange(UI.reportMonth);
    const txInMonth = DB.state.transactions.filter(
      (t) => t.date >= start && t.date <= end
    );

    // Chi tiêu theo thành viên (chi túi, loại trừ bản ghi đồng bộ)
    const byMember = {};
    DB.state.members.forEach((m) => (byMember[m.id] = 0));
    txInMonth
      .filter((t) => t.type === "Chi" && t.subType === "tui")
      .forEach((t) => {
        byMember[t.memberId] = (byMember[t.memberId] || 0) + t.amount;
      });
    const maxMember = Math.max(1, ...Object.values(byMember));

    // Chi tiêu theo danh mục (TOÀN BỘ Chi, cả quỹ lẫn túi) + xu hướng 6 tháng
    const catDetail = DB.categoryDetail(start, end);
    const anUong = catDetail.AnUong.total;
    const khac = catDetail.Khac.total;
    const totalCat = catDetail.grandTotal || 1;
    const trendSeries = DB.monthlySpendSeries(UI.reportMonth, 6);

    // Đóng quỹ tháng này: ai đã có giao dịch Thu (không phải đồng bộ) trong tháng
    const paidSet = new Set(
      txInMonth
        .filter((t) => t.type === "Thu" && !t.linkedId)
        .map((t) => t.memberId)
    );

    // Bữa ăn trong tháng
    const meals = DB.mealCountInRange(start, end);
    const maxMeal = Math.max(1, ...Object.values(meals).map((x) => x.total));

    return `
      <div class="card-row" style="margin-bottom:14px">
        <button class="btn" id="repPrevMonth">‹ Tháng trước</button>
        <div style="font-weight:700">${fmtMonthLabel(start)}</div>
        <button class="btn" id="repNextMonth">Tháng sau ›</button>
      </div>

      <div class="section-title">Tổng hợp chi tiêu theo danh mục</div>
      <div class="card">
        <div class="donut-wrap">
          ${donutSVG(
            [
              { label: "Ăn uống / đi chợ", value: anUong, color: "var(--primary)" },
              { label: "Khác", value: khac, color: "var(--gold)" },
            ],
            112
          )}
          <div class="donut-legend">
            <div class="legend-row">
              <div class="legend-dot" style="background:var(--primary)"></div>
              <div class="legend-text">
                <div class="legend-label">Ăn uống / đi chợ</div>
                <div class="legend-value">${fmtVND(anUong)}</div>
              </div>
              <div class="legend-pct">${((anUong / totalCat) * 100).toFixed(
                0
              )}%</div>
            </div>
            <div class="legend-row">
              <div class="legend-dot" style="background:var(--gold)"></div>
              <div class="legend-text">
                <div class="legend-label">Khác</div>
                <div class="legend-value">${fmtVND(khac)}</div>
              </div>
              <div class="legend-pct">${((khac / totalCat) * 100).toFixed(
                0
              )}%</div>
            </div>
          </div>
        </div>
      </div>

      <div class="section-title">Thống kê chi tiết từng mục</div>
      <div class="card">
        <div class="cat-detail-row">
          <div class="cat-detail-top">
            <div class="cat-detail-name">🍜 Ăn uống / đi chợ</div>
            <div class="cat-detail-total">${fmtVND(anUong)}</div>
          </div>
          <div class="cat-detail-meta"><b>${
            catDetail.AnUong.count
          }</b> giao dịch · trung bình <b>${fmtVND(
      catDetail.AnUong.avg
    )}</b>/giao dịch · chiếm <b>${((anUong / totalCat) * 100).toFixed(
      0
    )}%</b> tổng chi</div>
          <div class="bar-track"><div class="bar-fill" style="width:${(
            (anUong / totalCat) *
            100
          ).toFixed(1)}%;background:var(--primary)"></div></div>
        </div>
        <div class="cat-detail-row">
          <div class="cat-detail-top">
            <div class="cat-detail-name">🧾 Khác</div>
            <div class="cat-detail-total">${fmtVND(khac)}</div>
          </div>
          <div class="cat-detail-meta"><b>${
            catDetail.Khac.count
          }</b> giao dịch · trung bình <b>${fmtVND(
      catDetail.Khac.avg
    )}</b>/giao dịch · chiếm <b>${((khac / totalCat) * 100).toFixed(
      0
    )}%</b> tổng chi</div>
          <div class="bar-track"><div class="bar-fill" style="width:${(
            (khac / totalCat) *
            100
          ).toFixed(1)}%;background:var(--gold)"></div></div>
        </div>
      </div>

      <div class="section-title">Xu hướng chi tiêu 6 tháng gần đây</div>
      <div class="card">
        <div class="trend-wrap">${trendBarSVG(trendSeries)}</div>
        <div class="hint" style="margin-top:6px">Cột vàng là tháng đang xem ở trên. Tổng chi mỗi tháng gồm cả chi quỹ lẫn chi túi cá nhân.</div>
      </div>

      <div class="section-title">Chi tiêu theo thành viên</div>
      <div class="card">
        ${
          DB.state.members.length
            ? DB.state.members
                .map(
                  (m) => `
          <div class="bar-row">
            <div class="bar-top"><span>${esc(m.name)}</span><span>${fmtVND(
                    byMember[m.id] || 0
                  )}</span></div>
            <div class="bar-track"><div class="bar-fill" style="width:${(
              ((byMember[m.id] || 0) / maxMember) *
              100
            ).toFixed(1)}%"></div></div>
          </div>`
                )
                .join("")
            : emptyState("Chưa có dữ liệu")
        }
      </div>

      <div class="section-title">Đóng quỹ tháng này</div>
      <div class="card">
        ${
          DB.state.members.length
            ? DB.state.members
                .map(
                  (m) => `
          <div class="list-item">
            <div class="avatar">${esc(initials(m.name))}</div>
            <div class="li-main"><div class="li-title">${esc(m.name)}</div></div>
            <div class="${
              paidSet.has(m.id) ? "tag an" : "tag khac"
            }" style="padding:5px 10px">${
                    paidSet.has(m.id) ? "✓ Đã đóng" : "Chưa đóng"
                  }</div>
          </div>`
                )
                .join("")
            : emptyState("Chưa có dữ liệu")
        }
      </div>

      <div class="section-title">Số bữa ăn trong tháng</div>
      <div class="card">
        ${
          DB.state.members.length
            ? DB.state.members
                .map((m) => {
                  const d = meals[m.id] || { breakfast: 0, lunch: 0, dinner: 0, total: 0 };
                  return `
          <div class="bar-row">
            <div class="bar-top"><span>${esc(
              m.name
            )}</span><span>${d.total} bữa (🌅${d.breakfast} ☀️${d.lunch} 🌙${
                    d.dinner
                  })</span></div>
            <div class="bar-track"><div class="bar-fill" style="width:${(
              (d.total / maxMeal) *
              100
            ).toFixed(1)}%;background:var(--green)"></div></div>
          </div>`;
                })
                .join("")
            : emptyState("Chưa có dữ liệu")
        }
      </div>
    `;
  }

  function wireReportsEvents() {
    document.getElementById("repPrevMonth").onclick = () => {
      UI.reportMonth = shiftMonth(UI.reportMonth, -1);
      render();
    };
    document.getElementById("repNextMonth").onclick = () => {
      UI.reportMonth = shiftMonth(UI.reportMonth, 1);
      render();
    };
  }

  /* ================= SETTINGS / BACKUP ================= */
  function openSettingsModal() {
    openModal(
      "Cài đặt & Sao lưu",
      `
      <div class="form-group">
        <button class="btn primary block" id="btnExport">⬇️ Xuất dữ liệu (JSON)</button>
      </div>
      <div class="form-group">
        <button class="btn block" id="btnImport">⬆️ Nhập dữ liệu từ file JSON</button>
      </div>
      <div class="form-group">
        <button class="btn danger block" id="btnReset">🗑️ Xoá toàn bộ dữ liệu</button>
      </div>
      <div class="hint">Dữ liệu được lưu trên thiết bị này (localStorage). Hãy xuất file sao lưu định kỳ để không bị mất dữ liệu.</div>
    `,
      {
        onMount: () => {
          document.getElementById("btnExport").onclick = () => {
            DB.download();
            toast("Đã tải file sao lưu");
          };
          document.getElementById("btnImport").onclick = () => {
            document.getElementById("fileImport").click();
          };
          document.getElementById("btnReset").onclick = () => {
            if (
              confirm(
                "Xoá toàn bộ dữ liệu (thành viên, giao dịch, bữa ăn)? Hành động này không thể hoàn tác."
              )
            ) {
              DB.reset();
              closeModal();
              render();
              toast("Đã xoá toàn bộ dữ liệu");
            }
          };
        },
      }
    );
  }

  function wireGlobalImport() {
    const input = document.getElementById("fileImport");
    input.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = JSON.parse(reader.result);
          const incoming = DB.normalizeImported(parsed);
          const mode = confirm(
            `File có ${incoming.members.length} thành viên, ${incoming.transactions.length} giao dịch.\n\nNhấn OK để THAY THẾ toàn bộ dữ liệu hiện tại, hoặc Huỷ để GỘP vào dữ liệu hiện có.`
          );
          if (mode) {
            DB.state = incoming;
          } else {
            mergeState(incoming);
          }
          DB.save();
          closeModal();
          render();
          toast("Nhập dữ liệu thành công");
        } catch (err) {
          toast("File không hợp lệ");
        }
        input.value = "";
      };
      reader.readAsText(file);
    });
  }

  function mergeState(incoming) {
    const existingMemberIds = new Set(DB.state.members.map((m) => m.id));
    incoming.members.forEach((m) => {
      if (!existingMemberIds.has(m.id)) DB.state.members.push(m);
    });
    const existingTxIds = new Set(DB.state.transactions.map((t) => t.id));
    incoming.transactions.forEach((t) => {
      if (!existingTxIds.has(t.id)) DB.state.transactions.push(t);
    });
    Object.keys(incoming.meals).forEach((k) => {
      DB.state.meals[k] = incoming.meals[k];
    });
  }

  /* ================= SHARED HELPERS ================= */
  function emptyState(msg) {
    return `<div class="empty-state">${esc(msg)}</div>`;
  }

  /* ---------------------------------------------------------------- *
   *  INIT
   * ---------------------------------------------------------------- */
  function init() {
    DB.load();
    document.querySelectorAll(".tab-btn").forEach((btn) => {
      btn.onclick = () => setTab(btn.dataset.tab);
    });
    document.getElementById("btnSettings").onclick = openSettingsModal;
    wireGlobalImport();
    setTab("dashboard");
  }

  document.addEventListener("DOMContentLoaded", init);
})();
