/*
 * mapping.js — Shared data mapping between the ETA portal API responses and the
 * reference Excel layout ("eInvoices_2025-2026.xlsx": sheets جميع الفواتير / بيانات الفواتير).
 * Loaded in:
 *   - MAIN world on the portal (before inject_main.js)  -> window.__ETA_MAP
 *   - export window (next to SheetJS)                   -> window.__ETA_MAP
 * Pure functions only — no chrome.* and no fetch.
 */
(function (root) {
  'use strict';

  var HEADERS1 = ['مسلسل', 'تفاصيل', 'نوع المستند', 'نسخة المستند', 'الحالة', 'تاريخ الإصدار', 'تاريخ التقديم',
    'عملة الفاتورة', 'سعر العملة', 'مبلغ العملة', 'إجمالى المبيعات', 'قيمة الفاتورة',
    'ضريبة القيمة المضافة', 'T1%', 'ضريبة الجدول النسبية', 'T2%', 'ضريبة الجدول النوعية', 'T3%',
    'الخصم تحت حساب الضريبة', 'T4%', 'ضريبة الدمغة النسبية', 'T5%', 'ضريبة الدمغة قطعية بمقدار ثابت', 'T6%',
    'رسم تنمية الموارد', 'T8%', 'ضريبة الدمغة النسبية', 'T13%', 'ضريبة الدمغة قطعية بمقدار ثابت', 'T14%',
    'رسم تنمية الموارد', 'T16%', 'رسم خدمة', 'T17%', 'رسوم أخرى',
    'خصم الفاتورة', 'خصم الأصناف', 'خصم إضافى', 'إجمالى الفاتورة',
    'الرقم الداخلى', 'الرقم الإلكترونى', 'الرقم الضريبى للبائع', 'إسم البائع', 'عنوان البائع',
    'الرقم الضريبى للمشترى', 'إسم المشترى', 'عنوان المشترى',
    'مرجع طلب الشراء', 'وصف طلب الشراء', 'مرجع طلب المبيعات', 'وصف طلب المبيعات',
    'التوقيع الإلكترونى', 'الرابط الخارجى', 'خدمة التوصيل',
    'رقم الرسالة الجمركية', 'تاريخ الرسالة الجمركية', 'رقم المدفوعة', 'الرقم المرجعي'];

  var HEADERS2 = ['نوع المستند', 'نسخة المستند', 'الحالة', 'رقم الفاتورة', 'تاريخ الإصدار', 'تاريخ التقديم',
    'كود الصنف', 'الكود الداخلى', 'إسم الكود', 'الوصف', 'كود الوحدة', 'إسم الوحدة',
    'السعر', 'الكمية', 'المبيعات', 'القيمة',
    'ضريبة القيمة المضافة', 'T1%', 'ضريبة الجدول النسبية', 'T2%', 'ضريبة الجدول النوعية', 'T3%',
    'الخصم تحت حساب الضريبة', 'T4%', 'ضريبة الدمغة النسبية', 'T5%', 'ضريبة الدمغة قطعية بمقدار ثابت', 'T6%',
    'رسم تنمية الموارد', 'T8%', 'ضريبة الدمغة النسبية', 'T13%', 'ضريبة الدمغة قطعية بمقدار ثابت', 'T14%',
    'رسم تنمية الموارد', 'T16%', 'رسم خدمة', 'T17%', 'رسوم أخرى',
    'خصم', 'فرق قيمة لأغراض الضريبة', 'خصم الأصناف', 'الإجمالى',
    'العملة', 'سعر العملة', 'القيمة', 'الإجمالى',
    'الرقم الضريبى للبائع', 'إسم البائع', 'عنوان البائع', 'الرقم الضريبى للمشترى', 'إسم المشترى', 'عنوان المشترى',
    'مرجع طلب الشراء', 'وصف طلب الشراء', 'مرجع طلب المبيعات', 'وصف طلب المبيعات',
    'الرقم الإلكترونى', 'التوقيع الإلكترونى', 'خدمة التوصيل',
    'رقم الرسالة الجمركية', 'تاريخ الرسالة الجمركية', 'رقم المدفوعة', 'الرقم المرجعي'];

  // tax code -> [amountCol, rateCol] pairs per sheet
  var TAX_PAIRS1 = { T1: [12, 13], T2: [14, 15], T3: [16, 17], T4: [18, 19], T5: [20, 21], T6: [22, 23], T8: [24, 25], T13: [26, 27], T14: [28, 29], T16: [30, 31], T17: [32, 33] };
  var TAX_PAIRS2 = { T1: [16, 17], T2: [18, 19], T3: [20, 21], T4: [22, 23], T5: [24, 25], T6: [26, 27], T8: [28, 29], T13: [30, 31], T14: [32, 33], T16: [34, 35], T17: [36, 37] };
  var OTHER1 = 34, OTHER2 = 38;

  var DOC_TYPES = { i: 'فاتورة', c: 'إشعار دائن', d: 'إشعار مدين', ii: 'فاتورة استيراد', ei: 'فاتورة تصدير', ec: 'إشعار دائن تصدير', ed: 'إشعار مدين تصدير' };

  var UNITS = {
    KGM: 'Kilogram ( KG )', GRM: 'Gram ( G )', LTR: 'Litre ( L )', MLT: 'Millilitre ( ML )',
    MTR: 'Metre ( M )', CMT: 'Centimetre ( CM )', KMT: 'Kilometre ( KM )',
    MTK: 'Square metre ( M2 )', CMK: 'Square centimetre ( CM2 )', MTQ: 'Cubic metre ( M3 )', CMQ: 'Cubic centimetre ( CM3 )',
    TNE: 'Tonne ( T )', PCE: 'Number of units ( Unit )', NAR: 'Number of articles ( U )', H87: 'Piece ( pc )',
    HUR: 'Hour ( H )', DAY: 'Day known as Day ( D )', MON: 'Month ( Mo )', YER: 'Year ( Y )', E48: 'Unit of service ( svc unit )',
    SET: 'Set ( set )', PR: 'Pair ( pr )', AMC: 'Amount of currency ( amt )', ASU: 'Assorted units', BLD: 'Bars ( bar )',
    CET: 'Centilitre ( CL )', DZN: 'Dozen ( dz )', GLI: 'Gallon imperial ( G.I )', GLL: 'Gallon US ( G.U )', GRO: 'Gross ( g )',
    KT: 'Karat ( K )', LBR: 'Pound ( lb )', ONZ: 'Ounce ( oz )', MCU: 'Microgram ( mcg )', MGM: 'Milligram ( mg )',
    MMK: 'Square millimetre ( MM2 )', MMQ: 'Cubic millimetre ( MM3 )', MMT: 'Millimetre ( MM )', MTZ: 'Millihertz ( MHZ )',
    OZ: 'Ounce ( oz )', P1: 'Percentage ( % )', SAN: 'Semi ( semi )', SEC: 'Second ( S )', SM3: 'Standard cubic metre ( scm )',
    TPR: 'Ten pair ( 10pr )', WEE: 'Week ( W )', X1: 'Gem ( gem )'
  };

  function num(v) {
    if (v === null || v === undefined || v === '') return '';
    var n = typeof v === 'number' ? v : parseFloat(v);
    if (!isFinite(n)) return '';
    return Math.round(n * 10000) / 10000;
  }

  function str(v) { return (v === null || v === undefined) ? '' : String(v); }

  function fmtDate(s) {
    if (!s) return '';
    var t = String(s);
    t = t.replace('T', ' ').replace(/Z$/i, '');
    return t;
  }

  function firstKey(obj, keys) {
    for (var i = 0; i < keys.length; i++) {
      var v = obj ? obj[keys[i]] : undefined;
      if (v !== undefined && v !== null && v !== '') return v;
    }
    return '';
  }

  function joinAddr(a) {
    if (!a) return '';
    if (typeof a === 'string') return a;
    var parts = [];
    var b = str(a.buildingNumber).trim(), st = str(a.street).trim();
    var head = [b, st].filter(function (x) { return x !== ''; }).join(' / ');
    if (head) parts.push(head);
    var keys = ['city', 'citySubdivisionName', 'region', 'governorate', 'additionalInformation', 'landmark', 'department', 'additionalStreetName', 'postalCode'];
    for (var i = 0; i < keys.length; i++) {
      var v = str(a[keys[i]]).trim();
      if (v && parts.indexOf(v) === -1) parts.push(v);
    }
    return parts.join(' ');
  }

  // Best-effort: pull a human-readable CN out of the base64 CMS signature blob.
  function signatureCN(sigs) {
    try {
      if (!Array.isArray(sigs)) return '';
      for (var i = 0; i < sigs.length; i++) {
        var s = sigs[i] || {};
        var v = s.value || s.signature || s.serialNumber || '';
        if (typeof v !== 'string' || v.length < 40) continue;
        var bin;
        try { bin = atob(v); } catch (e) { continue; }
        var txt = bin;
        try { txt = new TextDecoder('utf-8', { fatal: false }).decode(Uint8Array.from(bin, function (c) { return c.charCodeAt(0) & 0xff; })); } catch (e2) {}
        var ar = txt.match(/[\u0600-\u06FF][\u0600-\u06FF\s\.]{4,}/);
        if (ar) return ar[0].trim();
        var la = txt.match(/[A-Za-z][A-Za-z\s\.&-]{8,}/);
        if (la) return la[0].trim();
      }
    } catch (e) {}
    return '';
  }

  // Doc-level taxes: taxTotals[] = {taxType, amount, rate?}; rates may be missing -> filled from lines later.
  function collectTaxes(r) {
    var m = {}, other = 0;
    var tt = Array.isArray(r.taxTotals) ? r.taxTotals : [];
    for (var i = 0; i < tt.length; i++) {
      var t = tt[i] || {};
      var key = String(t.taxType || t.type || '').toUpperCase();
      if (!key) continue;
      if (TAX_PAIRS1[key]) m[key] = { amount: num(t.amount), rate: num(t.rate) };
      else other += Number(t.amount) || 0;
    }
    var lines = r.invoiceLines || r.documentLines || [];
    if (Array.isArray(lines)) {
      Object.keys(m).forEach(function (k) {
        if (m[k].rate === '') {
          for (var j = 0; j < lines.length; j++) {
            var tis = (lines[j] && lines[j].taxableItems) || [];
            for (var q = 0; q < tis.length; q++) {
              if (String(tis[q].taxType || '').toUpperCase() === k && tis[q].rate != null) { m[k].rate = num(tis[q].rate); break; }
            }
            if (m[k].rate !== '') break;
          }
        }
      });
    }
    return { m: m, other: num(other) };
  }

  function collectLineTaxes(ln) {
    var m = {}, other = 0;
    var tis = Array.isArray(ln && ln.taxableItems) ? ln.taxableItems : [];
    for (var i = 0; i < tis.length; i++) {
      var t = tis[i] || {};
      var key = String(t.taxType || '').toUpperCase();
      if (!key) continue;
      if (TAX_PAIRS1[key]) m[key] = { amount: num(t.amount), rate: num(t.rate) };
      else other += Number(t.amount) || 0;
    }
    return { m: m, other: num(other) };
  }

  function applyTaxes(row, pairs, otherIdx, collected) {
    Object.keys(collected.m).forEach(function (k) {
      var p = pairs[k];
      if (p) { row[p[0]] = collected.m[k].amount; if (collected.m[k].rate !== '') row[p[1]] = collected.m[k].rate; }
    });
    if (collected.other !== '') row[otherIdx] = collected.other;
  }

  function currencyRate(r) {
    var v = firstKey(r, ['currencyRate', 'exchangeRate', 'currencyExchangeRate']);
    return num(v);
  }

  function customsFields(r) {
    var n = '', d = '';
    Object.keys(r || {}).forEach(function (k) {
      var kl = k.toLowerCase();
      if (!n && kl.indexOf('customs') !== -1 && kl.indexOf('number') !== -1) n = str(r[k]);
      if (!d && kl.indexOf('customs') !== -1 && (kl.indexOf('date') !== -1)) d = fmtDate(r[k]);
    });
    if (!n) n = str(firstKey(r, ['customsStatementNumber']));
    if (!d) d = fmtDate(firstKey(r, ['customsStatementDate']));
    return [n, d];
  }

  function deliveryText(r) {
    var d = r && r.delivery;
    if (d && typeof d === 'object') {
      return str(firstKey(d, ['approach', 'services', 'service']));
    }
    return str(firstKey(r || {}, ['deliveryService', 'deliveryApproach']));
  }

  function docInfo(s, raw) {
    var r = raw || {};
    var dtRaw = r.documentType || s.typeName || '';
    var cur = r.documentCurrency || s.documentCurrency || r.currency || 'EGP';
    var eid = s.uuid || r.uuid || s.longId || r.longId || '';
    var issued = fmtDate(r.dateTimeIssued || s.dateTimeIssued);
    var received = fmtDate(s.dateTimeReceived || r.dateTimeReceived);
    var ver = r.documentTypeVersion || s.typeVersionName || '';
    var status = s.status || r.status || '';
    var internal = str(r.internalID != null ? r.internalID : s.internalId);
    var issuer = r.issuer || {};
    var rec = r.receiver || {};
    return {
      typeName: DOC_TYPES[String(dtRaw).toLowerCase()] || s.documentTypeName || dtRaw,
      ver: ver, status: status, issued: issued, received: received, cur: cur, eid: eid,
      internal: internal, issuer: issuer, rec: rec,
      rate: currencyRate(r),
      sig: signatureCN(r.signatures),
      customs: customsFields(r),
      delivery: deliveryText(r)
    };
  }

  // summary (documents/recent row) + raw document (details/raw) -> 58-col row
  function mapInvoice(s, raw, seq) {
    var r = raw || {};
    var d = docInfo(s, raw);
    var row = new Array(HEADERS1.length).fill('');
    row[0] = seq != null ? seq : s.__seq;
    row[1] = 'عرض';
    row[2] = d.typeName;
    row[3] = d.ver;
    row[4] = d.status;
    row[5] = d.issued;
    row[6] = d.received;
    row[7] = d.cur;
    row[8] = d.rate;
    row[9] = d.cur !== 'EGP' ? num(firstKey(r, ['totalAmountForeignCurrency', 'foreignTotalAmount', 'totalAmountInCurrency'])) : '';
    row[10] = num(r.totalSales != null ? r.totalSales : s.totalSales);
    row[11] = num(r.netAmount != null ? r.netAmount : s.netAmount);
    applyTaxes(row, TAX_PAIRS1, OTHER1, collectTaxes(r));
    row[35] = num(r.totalDiscount);
    row[36] = num(r.totalItemsDiscountAmount);
    row[37] = num(r.extraDiscountAmount);
    row[38] = num(r.totalAmount != null ? r.totalAmount : s.total);
    row[39] = d.internal;
    row[40] = d.eid;
    row[41] = str(d.issuer.id || s.issuerId);
    row[42] = str(d.issuer.name || s.issuerName);
    row[43] = joinAddr(d.issuer.address);
    row[44] = str(d.rec.id || s.receiverId);
    row[45] = str(d.rec.name || s.receiverName);
    row[46] = joinAddr(d.rec.address);
    row[47] = str(r.purchaseOrderReference);
    row[48] = str(r.purchaseOrderDescription);
    row[49] = str(r.salesOrderReference);
    row[50] = str(r.salesOrderDescription);
    row[51] = d.sig;
    row[52] = str(s.publicUrl || r.shareUrl || ('https://invoicing.eta.gov.eg/documents/' + d.eid));
    row[53] = d.delivery;
    row[54] = d.customs[0];
    row[55] = d.customs[1];
    row[56] = str(firstKey(r, ['paymentNumber', 'paidNumber']));
    row[57] = str(firstKey(r, ['referenceNumber', 'invoiceReference']));
    return row;
  }

  // -> array of 64-col rows (one per invoice line)
  function mapLines(s, raw) {
    if (!raw) return [];
    var lines = raw.invoiceLines || raw.documentLines;
    if (!Array.isArray(lines) || !lines.length) return [];
    var d = docInfo(s, raw);
    var docItemsDiscount = num(raw.totalItemsDiscountAmount);
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i] || {};
      var row = new Array(HEADERS2.length).fill('');
      row[0] = d.typeName; row[1] = d.ver; row[2] = d.status;
      row[3] = d.internal; row[4] = d.issued; row[5] = d.received;
      var ic = ln.itemCode || {};
      row[6] = str(ic.codeValue);
      row[7] = str(firstKey(ic, ['internalCode', 'internalId']));
      row[8] = str(firstKey(ic, ['codeName', 'name']));
      row[9] = str(ln.description);
      var ut = ln.unitType || {};
      row[10] = str(ut.codeValue);
      row[11] = str(ut.name) || UNITS[ut.codeValue] || '';
      row[12] = num(ln.unitPrice);
      row[13] = num(ln.quantity);
      row[14] = num(ln.salesTotal);
      var taxes = collectLineTaxes(ln);
      var sumTax = 0, hasTax = false;
      Object.keys(taxes.m).forEach(function (k) { hasTax = true; if (typeof taxes.m[k].amount === 'number') sumTax += taxes.m[k].amount; });
      var disc = ln.discount ? num(ln.discount.discountAmount != null ? ln.discount.discountAmount : ln.discount.amount) : '';
      var vdiff = num(ln.valueDifference);
      var net = '';
      var lt = num(ln.total);
      if (hasTax && lt !== '') net = lt - sumTax;
      else {
        var st = num(ln.salesTotal);
        if (st !== '') net = st - (disc === '' ? 0 : disc) + (vdiff === '' ? 0 : vdiff);
      }
      row[15] = net === '' ? '' : Math.round(net * 10000) / 10000;
      applyTaxes(row, TAX_PAIRS2, OTHER2, taxes);
      row[39] = disc;
      row[40] = vdiff;
      row[41] = docItemsDiscount;
      row[42] = lt;
      row[43] = d.cur;
      row[44] = d.rate;
      row[45] = d.cur !== 'EGP' ? row[15] : '';
      row[46] = d.cur !== 'EGP' ? row[42] : '';
      row[47] = str(d.issuer.id || s.issuerId);
      row[48] = str(d.issuer.name || s.issuerName);
      row[49] = joinAddr(d.issuer.address);
      row[50] = str(d.rec.id || s.receiverId);
      row[51] = str(d.rec.name || s.receiverName);
      row[52] = joinAddr(d.rec.address);
      row[53] = str(raw.purchaseOrderReference);
      row[54] = str(raw.purchaseOrderDescription);
      row[55] = str(raw.salesOrderReference);
      row[56] = str(raw.salesOrderDescription);
      row[57] = d.eid;
      row[58] = d.sig;
      row[59] = d.delivery;
      row[60] = d.customs[0];
      row[61] = d.customs[1];
      row[62] = str(firstKey(raw, ['paymentNumber', 'paidNumber']));
      row[63] = str(firstKey(raw, ['referenceNumber', 'invoiceReference']));
      out.push(row);
    }
    return out;
  }

  root.__ETA_MAP = {
    HEADERS1: HEADERS1,
    HEADERS2: HEADERS2,
    mapInvoice: mapInvoice,
    mapLines: mapLines,
    num: num,
    fmtDate: fmtDate
  };
})(typeof window !== 'undefined' ? window : globalThis);
