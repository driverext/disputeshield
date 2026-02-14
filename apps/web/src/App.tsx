import { useEffect, useState } from "react";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import JSZip from "jszip";
import { Turnstile } from "@marsidev/react-turnstile";
import { BrowserRouter, Link, Route, Routes } from "react-router-dom";
import Home from "./pages/Home";

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

const SHOW_BRANDING_FOOTER = true;

const inputClassName =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200";

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

    if (SHOW_BRANDING_FOOTER) {
      page.drawText("Generated by DisputeShield.app", {
        x: margin,
        y: 42,
        size: 9,
        font,
        color: rgb(0, 0, 0),
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
    <div className="space-y-10">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold text-slate-900">
          Chargeback Evidence Generator
        </h1>
        <p className="text-sm text-slate-600">
          Complete the fields below to generate your evidence packet.
        </p>
      </div>

      <section className="space-y-6">
        <h2 className="text-lg font-semibold text-slate-900">Dispute details</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <label htmlFor="merchant_name" className="text-sm font-semibold">
              Merchant Name
            </label>
            <input
              id="merchant_name"
              className={inputClassName}
              value={form.merchant_name}
              onChange={(event) =>
                updateField("merchant_name", event.target.value)
              }
              placeholder="Acme Widgets"
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="order_id" className="text-sm font-semibold">
              Order ID
            </label>
            <input
              id="order_id"
              className={inputClassName}
              value={form.order_id}
              onChange={(event) => updateField("order_id", event.target.value)}
              placeholder="ORD-1042"
            />
            {!orderIdTrimmed.length && (
              <p className="text-sm text-red-600">Order ID is required.</p>
            )}
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <label htmlFor="amount" className="text-sm font-semibold">
              Amount
            </label>
            <input
              id="amount"
              className={inputClassName}
              value={form.amount}
              onChange={(event) => updateField("amount", event.target.value)}
              placeholder="120.00"
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="currency" className="text-sm font-semibold">
              Currency
            </label>
            <input
              id="currency"
              className={inputClassName}
              value={form.currency}
              onChange={(event) => updateField("currency", event.target.value)}
              placeholder="USD"
            />
          </div>
        </div>

        <div className="space-y-2">
          <label htmlFor="dispute_reason" className="text-sm font-semibold">
            Dispute Reason
          </label>
          <textarea
            id="dispute_reason"
            className={`${inputClassName} min-h-[96px]`}
            value={form.dispute_reason}
            onChange={(event) =>
              updateField("dispute_reason", event.target.value)
            }
            placeholder="Customer claims item not received."
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <label htmlFor="customer_email" className="text-sm font-semibold">
              Customer Email
            </label>
            <input
              id="customer_email"
              className={inputClassName}
              value={form.customer_email}
              onChange={(event) =>
                updateField("customer_email", event.target.value)
              }
              placeholder="customer@example.com"
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="ip_address" className="text-sm font-semibold">
              IP Address
            </label>
            <input
              id="ip_address"
              className={inputClassName}
              value={form.ip_address}
              onChange={(event) => updateField("ip_address", event.target.value)}
              placeholder="203.0.113.45"
            />
          </div>
        </div>

        <div className="space-y-2">
          <label htmlFor="billing_address" className="text-sm font-semibold">
            Billing Address
          </label>
          <input
            id="billing_address"
            className={inputClassName}
            value={form.billing_address}
            onChange={(event) =>
              updateField("billing_address", event.target.value)
            }
            placeholder="123 Main St, City, State"
          />
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <label htmlFor="tracking_number" className="text-sm font-semibold">
              Tracking Number
            </label>
            <input
              id="tracking_number"
              className={inputClassName}
              value={form.tracking_number}
              onChange={(event) =>
                updateField("tracking_number", event.target.value)
              }
              placeholder="1Z999AA10123456784"
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="carrier" className="text-sm font-semibold">
              Carrier
            </label>
            <input
              id="carrier"
              className={inputClassName}
              value={form.carrier}
              onChange={(event) => updateField("carrier", event.target.value)}
              placeholder="UPS"
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="delivery_date" className="text-sm font-semibold">
              Delivery Date
            </label>
            <input
              id="delivery_date"
              type="date"
              className={inputClassName}
              value={form.delivery_date}
              onChange={(event) =>
                updateField("delivery_date", event.target.value)
              }
            />
          </div>
        </div>

        <div className="space-y-2">
          <label htmlFor="policy_url" className="text-sm font-semibold">
            Policy URL
          </label>
          <input
            id="policy_url"
            className={inputClassName}
            value={form.policy_url}
            onChange={(event) => updateField("policy_url", event.target.value)}
            placeholder="https://example.com/refund-policy"
          />
        </div>

        <div className="space-y-2">
          <label
            htmlFor="refund_policy_excerpt"
            className="text-sm font-semibold"
          >
            Refund Policy Excerpt
          </label>
          <textarea
            id="refund_policy_excerpt"
            className={`${inputClassName} min-h-[96px]`}
            value={form.refund_policy_excerpt}
            onChange={(event) =>
              updateField("refund_policy_excerpt", event.target.value)
            }
            placeholder="Refunds are available within 30 days."
          />
        </div>

        <div className="space-y-2">
          <label
            htmlFor="customer_communication_notes"
            className="text-sm font-semibold"
          >
            Customer Communication Notes
          </label>
          <textarea
            id="customer_communication_notes"
            className={`${inputClassName} min-h-[96px]`}
            value={form.customer_communication_notes}
            onChange={(event) =>
              updateField("customer_communication_notes", event.target.value)
            }
            placeholder="Customer confirmed delivery on 2026-02-12."
          />
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Timeline</h2>
          <span className="text-xs text-slate-500">
            Normalized to sentence case in exports
          </span>
        </div>
        <div className="flex flex-col gap-3 md:flex-row">
          <input
            id="timeline"
            className={inputClassName}
            value={timelineInput}
            onChange={(event) => setTimelineInput(event.target.value)}
            placeholder="2026-02-10: Order shipped"
          />
          <button
            type="button"
            onClick={addTimelineEvent}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700"
          >
            Add Event
          </button>
        </div>

        <ul className="space-y-2">
          {form.timeline.map((event, index) => (
            <li
              key={`${event}-${index}`}
              className="flex items-start justify-between gap-4 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
            >
              <span>{event}</span>
              <button
                type="button"
                onClick={() => removeTimelineEvent(index)}
                className="text-xs font-semibold text-slate-500 hover:text-slate-700"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-4">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-slate-900">
            Attachments (local)
          </h2>
          <p className="text-sm text-slate-600">
            Uploading is disabled. Files stay on your device and are bundled in
            the ZIP.
          </p>
        </div>
        <input
          type="file"
          multiple
          onChange={(event) => {
            addAttachments(event.target.files);
            event.currentTarget.value = "";
          }}
        />

        {attachments.length === 0 ? (
          <p className="text-sm text-slate-500">No attachments selected.</p>
        ) : (
          <ul className="space-y-3">
            {attachments.map((attachment) => (
              <li
                key={attachment.id}
                className="space-y-3 rounded-xl border border-slate-200 bg-white p-4"
              >
                <div className="flex items-center justify-between text-sm font-semibold">
                  <span>{attachment.file.name}</span>
                  <span className="text-xs font-normal text-slate-500">
                    {attachment.file.size} bytes
                  </span>
                </div>
                <input
                  type="text"
                  className={inputClassName}
                  placeholder="Optional note"
                  value={attachment.note}
                  onChange={(event) =>
                    updateAttachmentNote(attachment.id, event.target.value)
                  }
                />
                <button
                  type="button"
                  className="text-xs font-semibold text-slate-500 hover:text-slate-700"
                  onClick={() => removeAttachment(attachment.id)}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-slate-900">Evidence checklist</h2>
        {showChecklistWarning && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
            2 or more recommended items are missing. Consider adding supporting
            evidence before exporting.
          </div>
        )}
        <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
          {checklist.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between text-sm"
            >
              <span className="text-slate-700">{item.label}</span>
              <span
                className={`text-xs font-semibold ${
                  item.present ? "text-emerald-600" : "text-rose-600"
                }`}
              >
                {item.present ? "Present" : "Missing"}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-slate-900">Human verification</h2>
        {isDev ? (
          <p className="text-sm text-slate-600">
            Turnstile bypass enabled in development.
          </p>
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
          <p className="text-sm text-red-600">
            Turnstile site key is not configured.
          </p>
        )}
        {showHumanVerificationMessage && (
          <p className="text-sm text-red-600">{humanVerifyMessage}</p>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={generatePdf}
            disabled={!canGeneratePdf}
            className="rounded-full bg-slate-900 px-6 py-3 text-sm font-semibold text-white shadow-soft disabled:cursor-not-allowed disabled:bg-slate-400"
          >
            {isGeneratingPdf ? "Generating PDF..." : "Generate PDF"}
          </button>
          <button
            type="button"
            onClick={downloadPdf}
            disabled={!pdfUrl}
            className="rounded-full border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Download PDF
          </button>
          <button
            type="button"
            onClick={downloadZip}
            disabled={!canExportZip}
            className="rounded-full border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isZipping ? "Building ZIP..." : "Download Evidence Packet (ZIP)"}
          </button>
        </div>
        {exportError && <p className="text-sm text-red-600">{exportError}</p>}
        {zipError && <p className="text-sm text-red-600">{zipError}</p>}
        {zipTip && <p className="text-sm text-slate-600">{zipTip}</p>}
        {zipSuccess && (
          <p className="text-sm text-emerald-600">{zipSuccess}</p>
        )}
      </section>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-slate-50">
        <header className="border-b border-slate-200 bg-white/80 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
            <Link to="/" className="text-lg font-semibold text-slate-900">
              DisputeShield
            </Link>
            <nav className="flex items-center gap-6 text-sm font-semibold text-slate-600">
              <Link to="/">Home</Link>
              <Link to="/app">App</Link>
            </nav>
          </div>
        </header>

        <div className="py-12">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route
              path="/app"
              element={
                <div className="mx-auto max-w-6xl px-6">
                  <EvidenceApp />
                </div>
              }
            />
            <Route path="*" element={<Home />} />
          </Routes>
        </div>

        <footer className="border-t border-slate-200 bg-white">
          <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-4 px-6 py-8 text-sm text-slate-500 md:flex-row md:items-center">
            <span>© 2026 DisputeShield. All rights reserved.</span>
            <span>Client-side evidence generation. Files never uploaded.</span>
          </div>
        </footer>
      </div>
    </BrowserRouter>
  );
}
