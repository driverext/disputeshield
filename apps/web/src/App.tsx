import { useEffect, useState } from "react";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import JSZip from "jszip";
import { Turnstile } from "@marsidev/react-turnstile";
import { BrowserRouter, Link, Route, Routes } from "react-router-dom";

type FormState = {
  merchant_name: string;
  order_id: string;
  amount: string;
  currency: string;
  dispute_reason: string;
  timeline: string[];
  customer_email: string;
  billing_address: string;
  ip_address: string;
  tracking_number: string;
  carrier: string;
  delivery_date: string;
  policy_url: string;
  refund_policy_excerpt: string;
  customer_communication_notes: string;
};

type ChecklistItem = {
  id: string;
  label: string;
  present: boolean;
};

type AttachmentItem = {
  id: string;
  file: File;
  note: string;
};

const initialState: FormState = {
  merchant_name: "",
  order_id: "",
  amount: "",
  currency: "USD",
  dispute_reason: "",
  timeline: [],
  customer_email: "",
  billing_address: "",
  ip_address: "",
  tracking_number: "",
  carrier: "",
  delivery_date: "",
  policy_url: "",
  refund_policy_excerpt: "",
  customer_communication_notes: "",
};

const wrapText = (text: string, maxLength: number) => {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return [""];
  }

  const lines: string[] = [];
  let line = "";

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length > maxLength) {
      if (line) {
        lines.push(line);
      }
      line = word;
    } else {
      line = candidate;
    }
  }

  if (line) {
    lines.push(line);
  }

  return lines;
};

const normalizeSentenceCase = (text: string) => {
  const trimmed = text.trim();
  if (!trimmed) {
    return "";
  }

  const lower = trimmed.toLowerCase();
  const sentence =
    lower.charAt(0).toUpperCase() + (lower.length > 1 ? lower.slice(1) : "");

  const replacements: Array<[RegExp, string]> = [
    [/\bups\b/gi, "UPS"],
    [/\busps\b/gi, "USPS"],
    [/\bfedex\b/gi, "FedEx"],
    [/\bdhl\b/gi, "DHL"],
  ];

  return replacements.reduce(
    (current, [pattern, value]) => current.replace(pattern, value),
    sentence,
  );
};

const normalizeTimelineEvent = (event: string) => {
  const trimmed = event.trim();
  if (!trimmed) {
    return "";
  }

  const match = trimmed.match(/^(\d{4}-\d{2}-\d{2})(\s*(?:-|:)\s*)(.+)$/);
  if (match) {
    const [, date, separator, description] = match;
    return `${date}${separator}${normalizeSentenceCase(description)}`;
  }

  return normalizeSentenceCase(trimmed);
};

const computeChecklist = (form: FormState): ChecklistItem[] => {
  const has = (value: string) => value.trim().length > 0;

  const proofOfDelivery =
    (has(form.tracking_number) && has(form.carrier)) ||
    has(form.delivery_date);
  const proofOfAuthorization =
    has(form.billing_address) || has(form.ip_address) || has(form.customer_email);
  const policies = has(form.policy_url) || has(form.refund_policy_excerpt);
  const communication = has(form.customer_communication_notes);

  return [
    {
      id: "proof_delivery",
      label: "Proof of delivery",
      present: proofOfDelivery,
    },
    {
      id: "proof_authorization",
      label: "Proof of authorization",
      present: proofOfAuthorization,
    },
    {
      id: "policies",
      label: "Policies",
      present: policies,
    },
    {
      id: "communication",
      label: "Customer communication",
      present: communication,
    },
  ];
};

const createAttachmentId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const copy = new Uint8Array(bytes);
  return copy.buffer;
};

function Home() {
  return (
    <div className="home">
      <div className="hero">
        <div>
          <p className="eyebrow">DisputeShield</p>
          <h1>Build bank-ready chargeback evidence in minutes.</h1>
          <p className="subhead">
            Generate a clean PDF + ZIP packet with timelines, policies, and
            attachment indexes—entirely client-side.
          </p>
          <Link to="/app" className="cta">
            Generate Evidence Packet
          </Link>
        </div>
      </div>
    </div>
  );
}

function EvidenceApp() {
  const [form, setForm] = useState<FormState>(initialState);
  const [timelineInput, setTimelineInput] = useState("");
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [isZipping, setIsZipping] = useState(false);
  const [zipError, setZipError] = useState<string | null>(null);
  const [zipSuccess, setZipSuccess] = useState<string | null>(null);
  const [zipTip, setZipTip] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const orderIdTrimmed = form.order_id.trim();
  const isDev = import.meta.env.DEV;
  const turnstileSiteKey = import.meta.env.VITE_TURNSTILE_SITEKEY as
    | string
    | undefined;
  const workerBaseUrl =
    (import.meta.env.VITE_WORKER_URL as string | undefined) ?? "";
  const workerVerifyUrl = workerBaseUrl
    ? `${workerBaseUrl.replace(/\/$/, "")}/turnstile/verify`
    : "/turnstile/verify";
  const humanVerifyMessage = "Verify you’re human to export.";
  const hasHumanToken = isDev || Boolean(turnstileToken);
  const canGeneratePdf = hasHumanToken && !isGeneratingPdf && !isVerifying;
  const canExportZip =
    orderIdTrimmed.length > 0 && hasHumanToken && !isZipping && !isVerifying;
  const checklist = computeChecklist(form);
  const missingChecklistCount = checklist.filter((item) => !item.present).length;
  const showChecklistWarning = missingChecklistCount >= 2;
  const hasAttachments = attachments.length > 0;

  useEffect(() => {
    return () => {
      if (pdfUrl) {
        URL.revokeObjectURL(pdfUrl);
      }
    };
  }, [pdfUrl]);

  const updateField = (field: keyof FormState, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const addTimelineEvent = () => {
    const trimmed = timelineInput.trim();
    if (!trimmed) {
      return;
    }

    setForm((prev) => ({
      ...prev,
      timeline: [...prev.timeline, trimmed],
    }));
    setTimelineInput("");
  };

  const removeTimelineEvent = (index: number) => {
    setForm((prev) => ({
      ...prev,
      timeline: prev.timeline.filter((_, i) => i !== index),
    }));
  };

  const addAttachments = (files: FileList | null) => {
    if (!files || files.length === 0) {
      return;
    }

    const nextItems = Array.from(files).map((file) => ({
      id: createAttachmentId(),
      file,
      note: "",
    }));

    setAttachments((prev) => [...prev, ...nextItems]);
  };

  const updateAttachmentNote = (id: string, value: string) => {
    setAttachments((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, note: value } : item,
      ),
    );
  };

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((item) => item.id !== id));
  };

  const sanitizeFilenamePart = (value: string) => {
    const cleaned = value
      .trim()
      .replace(/[^a-z0-9_-]+/gi, "_")
      .replace(/^_+|_+$/g, "");
    return cleaned || "unknown";
  };

  const csvEscape = (value: string) => `"${value.replace(/"/g, '""')}"`;

  const verifyTurnstileToken = async () => {
    if (isDev) {
      return true;
    }

    if (!turnstileToken) {
      return false;
    }

    setIsVerifying(true);
    try {
      const response = await fetch(workerVerifyUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: turnstileToken }),
      });

      if (!response.ok) {
        return false;
      }

      const data = (await response.json()) as { ok?: boolean };
      const ok = Boolean(data.ok);
      if (!ok) {
        setTurnstileToken(null);
      }
      return ok;
    } catch (error) {
      console.error(error);
      return false;
    } finally {
      setIsVerifying(false);
    }
  };

  const createPdfBytes = async () => {
    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

    let page = pdfDoc.addPage();
    const { height } = page.getSize();
    const margin = 50;
    const defaultSize = 12;
    const lineGap = 6;
    let y = height - margin;

    const ensureSpace = (lines: number, size: number) => {
      const required = lines * (size + lineGap);
      if (y - required < margin) {
        page = pdfDoc.addPage();
        y = height - margin;
      }
    };

    const drawLine = (text: string, size = defaultSize) => {
      ensureSpace(1, size);
      page.drawText(text, {
        x: margin,
        y,
        size,
        font,
        color: rgb(0, 0, 0),
      });
      y -= size + lineGap;
    };

    const drawLines = (lines: string[], size = defaultSize, indent = 0) => {
      for (const line of lines) {
        ensureSpace(1, size);
        page.drawText(line, {
          x: margin + indent,
          y,
          size,
          font,
          color: rgb(0, 0, 0),
        });
        y -= size + lineGap;
      }
    };

    const checklistItems = computeChecklist(form);
    const compellingItems = [
      ...checklistItems.filter((item) => item.present),
      ...checklistItems.filter((item) => !item.present),
    ];

    drawLine("Chargeback Evidence", 20);
    y -= 8;

    drawLine("Summary", 14);
    drawLine(`Merchant: ${form.merchant_name || "—"}`);
    drawLine(`Order ID: ${form.order_id || "—"}`);
    drawLine(
      `Amount: ${form.amount ? `${form.amount} ${form.currency}` : "—"}`,
    );

    y -= 10;
    drawLine("Timeline", 14);

    if (form.timeline.length === 0) {
      drawLine("No timeline events added.");
    } else {
      form.timeline.forEach((event) => {
        const normalized = normalizeTimelineEvent(event);
        const wrapped = wrapText(normalized, 90);
        if (wrapped.length > 0) {
          const [first, ...rest] = wrapped;
          drawLines([`• ${first}`], defaultSize, 0);
          if (rest.length > 0) {
            drawLines(rest, defaultSize, 16);
          }
        }
      });
    }

    y -= 10;
    drawLine("Key Evidence Summary (Prioritized for Review)", 14);
    compellingItems.forEach((item) => {
      drawLine(`• ${item.label} — ${item.present ? "Present" : "Missing"}`);
    });

    y -= 10;
    drawLine("Evidence Checklist", 14);
    checklistItems.forEach((item) => {
      drawLine(`• ${item.label} — ${item.present ? "Present" : "Missing"}`);
    });

    y -= 10;
    drawLine("Attachment Index", 14);
    if (attachments.length === 0) {
      drawLine("No attachments included.");
    } else {
      attachments.forEach((attachment) => {
        const note = attachment.note.trim();
        const entry = note
          ? `${attachment.file.name} — ${note}`
          : attachment.file.name;
        const wrapped = wrapText(entry, 90);
        if (wrapped.length > 0) {
          const [first, ...rest] = wrapped;
          drawLines([`• ${first}`], defaultSize, 0);
          if (rest.length > 0) {
            drawLines(rest, defaultSize, 16);
          }
        }
      });
    }

    page.drawText(`Generated by DisputeShield on ${new Date().toLocaleString()}`, {
      x: margin,
      y: 30,
      size: 10,
      font,
      color: rgb(0, 0, 0),
    });

    return pdfDoc.save();
  };

  const setPdfFromBytes = (bytes: Uint8Array) => {
    const blob = new Blob([toArrayBuffer(bytes)], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);

    setPdfUrl((prev) => {
      if (prev) {
        URL.revokeObjectURL(prev);
      }
      return url;
    });
  };

  const generatePdf = async () => {
    if (!hasHumanToken) {
      setExportError(humanVerifyMessage);
      return;
    }

    setIsGeneratingPdf(true);
    setExportError(null);
    try {
      const verified = await verifyTurnstileToken();
      if (!verified) {
        setExportError("Human verification failed. Please try again.");
        return;
      }

      const bytes = await createPdfBytes();
      setPdfBytes(bytes);
      setPdfFromBytes(bytes);
    } catch (error) {
      console.error(error);
      setExportError("Failed to generate PDF. Please try again.");
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  const downloadPdf = () => {
    if (!pdfUrl) {
      return;
    }

    const link = document.createElement("a");
    link.href = pdfUrl;
    link.download = "chargeback-evidence.pdf";
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const downloadZip = async () => {
    if (!orderIdTrimmed.length) {
      setZipError("Order ID is required.");
      setZipSuccess(null);
      setZipTip(null);
      return;
    }

    if (!hasHumanToken) {
      setZipError(humanVerifyMessage);
      setZipSuccess(null);
      setZipTip(null);
      return;
    }

    setIsZipping(true);
    setZipError(null);
    setZipSuccess(null);
    setZipTip(null);

    try {
      const verified = await verifyTurnstileToken();
      if (!verified) {
        setZipError("Human verification failed. Please try again.");
        return;
      }

      let bytes = pdfBytes;
      if (!bytes) {
        bytes = await createPdfBytes();
        setPdfBytes(bytes);
        setPdfFromBytes(bytes);
      }

      if (!hasAttachments) {
        setZipTip(
          "Tip: banks often prefer screenshots/PDFs of tracking, policies, and customer communications.",
        );
      }

      const checklistItems = computeChecklist(form);
      const checklistLines = checklistItems.map(
        (item) => `- ${item.label}: ${item.present ? "Present" : "Missing"}`,
      );

      const summary = [
        `Merchant Name: ${form.merchant_name || "—"}`,
        `Order ID: ${form.order_id || "—"}`,
        `Amount: ${form.amount || "—"}`,
        `Currency: ${form.currency || "—"}`,
        `Dispute Reason: ${form.dispute_reason || "—"}`,
        `Customer Email: ${form.customer_email || "—"}`,
        `Billing Address: ${form.billing_address || "—"}`,
        `IP Address: ${form.ip_address || "—"}`,
        `Tracking Number: ${form.tracking_number || "—"}`,
        `Carrier: ${form.carrier || "—"}`,
        `Delivery Date: ${form.delivery_date || "—"}`,
        `Policy URL: ${form.policy_url || "—"}`,
        `Refund Policy Excerpt: ${form.refund_policy_excerpt || "—"}`,
        `Customer Communication Notes: ${
          form.customer_communication_notes || "—"
        }`,
        "",
        "Checklist:",
        ...checklistLines,
      ].join("\n");

      const csvLines = ["index,event"];
      form.timeline.forEach((event, index) => {
        const normalized = normalizeTimelineEvent(event);
        csvLines.push(`${index + 1},${csvEscape(normalized)}`);
      });

      const zip = new JSZip();
      const attachmentsFolder = zip.folder("attachments");
      if (attachmentsFolder) {
        attachments.forEach((attachment) => {
          attachmentsFolder.file(attachment.file.name, attachment.file);
        });

        const indexLines = ["filename,size_bytes,note"];
        attachments.forEach((attachment) => {
          indexLines.push(
            [
              csvEscape(attachment.file.name),
              attachment.file.size,
              csvEscape(attachment.note || ""),
            ].join(","),
          );
        });

        attachmentsFolder.file("index.csv", indexLines.join("\n"));
        attachmentsFolder.file(
          "README.txt",
          "Place screenshots/tracking proofs here before submitting.",
        );
      }

      zip.file("evidence.pdf", bytes);
      zip.file("summary.txt", summary);
      zip.file("timeline.csv", csvLines.join("\n"));

      const zipBlob = await zip.generateAsync({ type: "blob" });
      const safeOrderId = sanitizeFilenamePart(orderIdTrimmed);
      const zipName = `dispute-evidence-${safeOrderId}.zip`;

      const link = document.createElement("a");
      const zipUrl = URL.createObjectURL(zipBlob);
      link.href = zipUrl;
      link.download = zipName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(zipUrl);

      setZipSuccess("ZIP download started.");
    } catch (error) {
      console.error(error);
      setZipError("Failed to generate ZIP. Please try again.");
    } finally {
      setIsZipping(false);
    }
  };

  const showHumanVerificationMessage =
    !hasHumanToken && !isDev && !exportError && !zipError;

  return (
    <div>
      <h1>Chargeback Evidence Generator</h1>

      <div className="section">
        <div className="form-row">
          <div>
            <label htmlFor="merchant_name">Merchant Name</label>
            <input
              id="merchant_name"
              value={form.merchant_name}
              onChange={(event) =>
                updateField("merchant_name", event.target.value)
              }
              placeholder="Acme Widgets"
            />
          </div>
          <div>
            <label htmlFor="order_id">Order ID</label>
            <input
              id="order_id"
              value={form.order_id}
              onChange={(event) => updateField("order_id", event.target.value)}
              placeholder="ORD-1042"
            />
            {!orderIdTrimmed.length && (
              <p className="message error">Order ID is required.</p>
            )}
          </div>
        </div>

        <div className="form-row">
          <div>
            <label htmlFor="amount">Amount</label>
            <input
              id="amount"
              value={form.amount}
              onChange={(event) => updateField("amount", event.target.value)}
              placeholder="120.00"
            />
          </div>
          <div>
            <label htmlFor="currency">Currency</label>
            <input
              id="currency"
              value={form.currency}
              onChange={(event) => updateField("currency", event.target.value)}
              placeholder="USD"
            />
          </div>
        </div>

        <div className="form-row">
          <div>
            <label htmlFor="dispute_reason">Dispute Reason</label>
            <textarea
              id="dispute_reason"
              value={form.dispute_reason}
              onChange={(event) =>
                updateField("dispute_reason", event.target.value)
              }
              placeholder="Customer claims item not received."
            />
          </div>
        </div>

        <div className="form-row">
          <div>
            <label htmlFor="customer_email">Customer Email</label>
            <input
              id="customer_email"
              value={form.customer_email}
              onChange={(event) =>
                updateField("customer_email", event.target.value)
              }
              placeholder="customer@example.com"
            />
          </div>
          <div>
            <label htmlFor="ip_address">IP Address</label>
            <input
              id="ip_address"
              value={form.ip_address}
              onChange={(event) => updateField("ip_address", event.target.value)}
              placeholder="203.0.113.45"
            />
          </div>
        </div>

        <div className="form-row">
          <div>
            <label htmlFor="billing_address">Billing Address</label>
            <input
              id="billing_address"
              value={form.billing_address}
              onChange={(event) =>
                updateField("billing_address", event.target.value)
              }
              placeholder="123 Main St, City, State"
            />
          </div>
        </div>

        <div className="form-row">
          <div>
            <label htmlFor="tracking_number">Tracking Number</label>
            <input
              id="tracking_number"
              value={form.tracking_number}
              onChange={(event) =>
                updateField("tracking_number", event.target.value)
              }
              placeholder="1Z999AA10123456784"
            />
          </div>
          <div>
            <label htmlFor="carrier">Carrier</label>
            <input
              id="carrier"
              value={form.carrier}
              onChange={(event) => updateField("carrier", event.target.value)}
              placeholder="UPS"
            />
          </div>
          <div>
            <label htmlFor="delivery_date">Delivery Date</label>
            <input
              id="delivery_date"
              type="date"
              value={form.delivery_date}
              onChange={(event) =>
                updateField("delivery_date", event.target.value)
              }
            />
          </div>
        </div>

        <div className="form-row">
          <div>
            <label htmlFor="policy_url">Policy URL</label>
            <input
              id="policy_url"
              value={form.policy_url}
              onChange={(event) => updateField("policy_url", event.target.value)}
              placeholder="https://example.com/refund-policy"
            />
          </div>
        </div>

        <div className="form-row">
          <div>
            <label htmlFor="refund_policy_excerpt">Refund Policy Excerpt</label>
            <textarea
              id="refund_policy_excerpt"
              value={form.refund_policy_excerpt}
              onChange={(event) =>
                updateField("refund_policy_excerpt", event.target.value)
              }
              placeholder="Refunds are available within 30 days."
            />
          </div>
        </div>

        <div className="form-row">
          <div>
            <label htmlFor="customer_communication_notes">
              Customer Communication Notes
            </label>
            <textarea
              id="customer_communication_notes"
              value={form.customer_communication_notes}
              onChange={(event) =>
                updateField("customer_communication_notes", event.target.value)
              }
              placeholder="Customer confirmed delivery on 2026-02-12."
            />
          </div>
        </div>
      </div>

      <div className="section">
        <label htmlFor="timeline">Timeline Events</label>
        <div className="form-row">
          <div>
            <input
              id="timeline"
              value={timelineInput}
              onChange={(event) => setTimelineInput(event.target.value)}
              placeholder="2026-02-10: Order shipped"
            />
          </div>
          <div>
            <button type="button" onClick={addTimelineEvent}>
              Add Event
            </button>
          </div>
        </div>

        <ul className="timeline-list">
          {form.timeline.map((event, index) => (
            <li key={`${event}-${index}`} className="timeline-item">
              <span>{event}</span>
              <button type="button" onClick={() => removeTimelineEvent(index)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="section">
        <h2>Attachments (local)</h2>
        <input
          type="file"
          multiple
          onChange={(event) => {
            addAttachments(event.target.files);
            event.currentTarget.value = "";
          }}
        />

        {attachments.length === 0 ? (
          <p className="message">No attachments selected.</p>
        ) : (
          <ul className="attachments-list">
            {attachments.map((attachment) => (
              <li key={attachment.id} className="attachment-item">
                <div className="attachment-meta">
                  <span>{attachment.file.name}</span>
                  <span className="attachment-size">
                    {attachment.file.size} bytes
                  </span>
                </div>
                <input
                  type="text"
                  placeholder="Optional note"
                  value={attachment.note}
                  onChange={(event) =>
                    updateAttachmentNote(attachment.id, event.target.value)
                  }
                />
                <button
                  type="button"
                  className="secondary"
                  onClick={() => removeAttachment(attachment.id)}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="section">
        <h2>Evidence Checklist</h2>
        {showChecklistWarning && (
          <div className="warning">
            2 or more recommended items are missing. Consider adding supporting
            evidence before exporting.
          </div>
        )}
        <div className="checklist">
          {checklist.map((item) => (
            <div className="checklist-item" key={item.id}>
              <span>{item.label}</span>
              <span className={`status ${item.present ? "present" : "missing"}`}>
                {item.present ? "Present" : "Missing"}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="section">
        <h2>Human Verification</h2>
        {isDev ? (
          <p className="message">Turnstile bypass enabled in development.</p>
        ) : turnstileSiteKey ? (
          <Turnstile
            siteKey={turnstileSiteKey}
            onSuccess={(token) => {
              setTurnstileToken(token);
              if (exportError === humanVerifyMessage) {
                setExportError(null);
              }
              if (zipError === humanVerifyMessage) {
                setZipError(null);
              }
            }}
            onExpire={() => setTurnstileToken(null)}
            onError={() => setTurnstileToken(null)}
          />
        ) : (
          <p className="message error">Turnstile site key is not configured.</p>
        )}
        {showHumanVerificationMessage && (
          <p className="message error">{humanVerifyMessage}</p>
        )}
      </div>

      <div className="actions">
        <button type="button" onClick={generatePdf} disabled={!canGeneratePdf}>
          {isGeneratingPdf ? "Generating PDF..." : "Generate PDF"}
        </button>
        <button type="button" onClick={downloadPdf} disabled={!pdfUrl}>
          Download PDF
        </button>
        <button type="button" onClick={downloadZip} disabled={!canExportZip}>
          {isZipping ? "Building ZIP..." : "Download Evidence Packet (ZIP)"}
        </button>
      </div>
      {exportError && <p className="message error">{exportError}</p>}
      {zipError && <p className="message error">{zipError}</p>}
      {zipTip && <p className="message">{zipTip}</p>}
      {zipSuccess && <p className="message success">{zipSuccess}</p>}
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <div className="nav">
        <Link to="/" className="nav-brand">
          DisputeShield
        </Link>
        <div className="nav-links">
          <Link to="/">Home</Link>
          <Link to="/app">App</Link>
        </div>
      </div>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/app" element={<EvidenceApp />} />
        <Route path="*" element={<Home />} />
      </Routes>
    </BrowserRouter>
  );
}
