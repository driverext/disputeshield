import { useEffect, useState } from "react";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import JSZip from "jszip";
import { Turnstile } from "@marsidev/react-turnstile";
import { BrowserRouter, Link, Route, Routes } from "react-router-dom";
import Home from "./pages/Home";

const DISPUTE_REASONS = [
  { value: "fraud", label: "Fraud/Unauthorized" },
  { value: "product_not_received", label: "Product not received" },
  { value: "product_unacceptable", label: "Product unacceptable" },
  { value: "credit_not_processed", label: "Credit not processed" },
  { value: "duplicate_unrecognized", label: "Duplicate/Unrecognized" },
  { value: "other", label: "Other" },
] as const;

type DisputeReason = (typeof DISPUTE_REASONS)[number]["value"];

const getReasonLabel = (reason: DisputeReason) =>
  DISPUTE_REASONS.find((item) => item.value === reason)?.label ?? "Other";

type FormState = {
  merchant_name: string;
  order_id: string;
  amount: string;
  currency: string;
  dispute_reason: DisputeReason;
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

type AttachmentItem = {
  id: string;
  file: File;
  note: string;
};

type PdfStats = {
  sizeBytes: number;
  pageCount: number;
};

type EvidencePriority = "critical" | "recommended";

type EvidenceCatalogEntry = {
  label: string;
  tooltip: string;
  isPresent: (form: FormState, attachments: AttachmentItem[]) => boolean;
};

const initialState: FormState = {
  merchant_name: "",
  order_id: "",
  amount: "",
  currency: "USD",
  dispute_reason: DISPUTE_REASONS[0].value,
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
const PDF_SIZE_WARNING_BYTES = 2_500_000;
const PDF_PAGE_WARNING_COUNT = 20;
const ATTACHMENTS_WARNING_BYTES = 10 * 1024 * 1024;

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

const hasValue = (value: string) => value.trim().length > 0;

const EVIDENCE_CATALOG = {
  proof_delivery: {
    label: "Proof of delivery",
    tooltip: "Tracking + carrier or delivery confirmation date.",
    isPresent: (form: FormState) =>
      (hasValue(form.tracking_number) && hasValue(form.carrier)) ||
      hasValue(form.delivery_date),
  },
  tracking_details: {
    label: "Tracking details",
    tooltip: "Carrier tracking number for shipment evidence.",
    isPresent: (form: FormState) => hasValue(form.tracking_number),
  },
  carrier_info: {
    label: "Carrier confirmation",
    tooltip: "Carrier name or service used for fulfillment.",
    isPresent: (form: FormState) => hasValue(form.carrier),
  },
  delivery_date: {
    label: "Delivery confirmation date",
    tooltip: "Date the carrier marked the package delivered.",
    isPresent: (form: FormState) => hasValue(form.delivery_date),
  },
  authorization_signals: {
    label: "Authorization signals",
    tooltip: "Billing address, IP, or customer email match.",
    isPresent: (form: FormState) =>
      hasValue(form.billing_address) ||
      hasValue(form.ip_address) ||
      hasValue(form.customer_email),
  },
  billing_address: {
    label: "Billing address match",
    tooltip: "Billing address captured at checkout.",
    isPresent: (form: FormState) => hasValue(form.billing_address),
  },
  ip_address: {
    label: "IP address match",
    tooltip: "IP captured during checkout or account login.",
    isPresent: (form: FormState) => hasValue(form.ip_address),
  },
  customer_email: {
    label: "Customer email match",
    tooltip: "Email captured at checkout.",
    isPresent: (form: FormState) => hasValue(form.customer_email),
  },
  policies: {
    label: "Refund/cancellation policy",
    tooltip: "Published policy URL or excerpt.",
    isPresent: (form: FormState) =>
      hasValue(form.policy_url) || hasValue(form.refund_policy_excerpt),
  },
  refund_policy_excerpt: {
    label: "Policy excerpt",
    tooltip: "Relevant policy text for the dispute reason.",
    isPresent: (form: FormState) => hasValue(form.refund_policy_excerpt),
  },
  policy_url: {
    label: "Policy URL",
    tooltip: "Link to your published policy page.",
    isPresent: (form: FormState) => hasValue(form.policy_url),
  },
  customer_comms: {
    label: "Customer communications",
    tooltip: "Emails, chats, or tickets acknowledging the order.",
    isPresent: (form: FormState) => hasValue(form.customer_communication_notes),
  },
  timeline: {
    label: "Timeline of events",
    tooltip: "Key order, fulfillment, and delivery milestones.",
    isPresent: (form: FormState) => form.timeline.length > 0,
  },
  attachments: {
    label: "Supporting attachments",
    tooltip: "Screenshots, receipts, tracking scans, or files.",
    isPresent: (_form: FormState, attachments: AttachmentItem[]) =>
      attachments.length > 0,
  },
} satisfies Record<string, EvidenceCatalogEntry>;

type EvidenceId = keyof typeof EVIDENCE_CATALOG;

type EvidenceItem = {
  id: EvidenceId;
  label: string;
  tooltip: string;
  priority: EvidencePriority;
  present: boolean;
};

const REASON_EVIDENCE_MAP: Record<
  DisputeReason,
  { items: Array<{ id: EvidenceId; priority: EvidencePriority }> }
> = {
  fraud: {
    items: [
      { id: "authorization_signals", priority: "critical" },
      { id: "ip_address", priority: "critical" },
      { id: "billing_address", priority: "recommended" },
      { id: "customer_email", priority: "recommended" },
      { id: "customer_comms", priority: "recommended" },
      { id: "timeline", priority: "recommended" },
      { id: "attachments", priority: "recommended" },
    ],
  },
  product_not_received: {
    items: [
      { id: "proof_delivery", priority: "critical" },
      { id: "tracking_details", priority: "critical" },
      { id: "carrier_info", priority: "recommended" },
      { id: "delivery_date", priority: "recommended" },
      { id: "customer_comms", priority: "recommended" },
      { id: "timeline", priority: "recommended" },
      { id: "attachments", priority: "recommended" },
    ],
  },
  product_unacceptable: {
    items: [
      { id: "policies", priority: "critical" },
      { id: "customer_comms", priority: "critical" },
      { id: "attachments", priority: "critical" },
      { id: "timeline", priority: "recommended" },
      { id: "refund_policy_excerpt", priority: "recommended" },
      { id: "delivery_date", priority: "recommended" },
      { id: "authorization_signals", priority: "recommended" },
    ],
  },
  credit_not_processed: {
    items: [
      { id: "policies", priority: "critical" },
      { id: "customer_comms", priority: "critical" },
      { id: "timeline", priority: "critical" },
      { id: "refund_policy_excerpt", priority: "recommended" },
      { id: "attachments", priority: "recommended" },
      { id: "authorization_signals", priority: "recommended" },
    ],
  },
  duplicate_unrecognized: {
    items: [
      { id: "authorization_signals", priority: "critical" },
      { id: "timeline", priority: "critical" },
      { id: "billing_address", priority: "recommended" },
      { id: "ip_address", priority: "recommended" },
      { id: "customer_comms", priority: "recommended" },
      { id: "attachments", priority: "recommended" },
    ],
  },
  other: {
    items: [
      { id: "timeline", priority: "critical" },
      { id: "attachments", priority: "recommended" },
      { id: "policies", priority: "recommended" },
      { id: "customer_comms", priority: "recommended" },
      { id: "authorization_signals", priority: "recommended" },
      { id: "proof_delivery", priority: "recommended" },
    ],
  },
};

const buildEvidenceItems = (
  reason: DisputeReason,
  form: FormState,
  attachments: AttachmentItem[],
): EvidenceItem[] => {
  const config = REASON_EVIDENCE_MAP[reason] ?? REASON_EVIDENCE_MAP.other;
  return config.items.map((item) => {
    const definition = EVIDENCE_CATALOG[item.id];
    return {
      id: item.id,
      label: definition.label,
      tooltip: definition.tooltip,
      priority: item.priority,
      present: definition.isPresent(form, attachments),
    };
  });
};

const sortEvidenceByStrength = (items: EvidenceItem[]) => {
  const priorityRank: Record<EvidencePriority, number> = {
    critical: 0,
    recommended: 1,
  };

  return [...items].sort((a, b) => {
    if (a.present !== b.present) {
      return a.present ? -1 : 1;
    }
    const priorityDelta = priorityRank[a.priority] - priorityRank[b.priority];
    if (priorityDelta !== 0) {
      return priorityDelta;
    }
    return a.label.localeCompare(b.label);
  });
};

const sortEvidenceByPriority = (items: EvidenceItem[]) => {
  const priorityRank: Record<EvidencePriority, number> = {
    critical: 0,
    recommended: 1,
  };

  return [...items].sort((a, b) => {
    const priorityDelta = priorityRank[a.priority] - priorityRank[b.priority];
    if (priorityDelta !== 0) {
      return priorityDelta;
    }
    return a.label.localeCompare(b.label);
  });
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

const formatBytes = (bytes: number) => {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const kb = bytes / 1024;
  if (kb < 1024) {
    return `${kb.toFixed(1)} KB`;
  }
  const mb = kb / 1024;
  return `${mb.toFixed(2)} MB`;
};

function EvidenceApp() {
  const [form, setForm] = useState<FormState>(initialState);
  const [timelineInput, setTimelineInput] = useState("");
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [pdfStats, setPdfStats] = useState<PdfStats | null>(null);
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
  const reason = form.dispute_reason;
  const reasonLabel = getReasonLabel(reason);
  const evidenceItems = buildEvidenceItems(reason, form, attachments);
  const criticalEvidence = evidenceItems.filter(
    (item) => item.priority === "critical",
  );
  const recommendedEvidence = evidenceItems.filter(
    (item) => item.priority === "recommended",
  );
  const missingRecommendedCount = recommendedEvidence.filter(
    (item) => !item.present,
  ).length;
  const showChecklistWarning = missingRecommendedCount >= 2;
  const hasAttachments = attachments.length > 0;
  const attachmentsTotalBytes = attachments.reduce(
    (total, item) => total + item.file.size,
    0,
  );
  const showPdfLimitWarning =
    pdfStats !== null &&
    (pdfStats.sizeBytes > PDF_SIZE_WARNING_BYTES ||
      pdfStats.pageCount > PDF_PAGE_WARNING_COUNT);
  const showAttachmentSizeWarning =
    attachmentsTotalBytes > ATTACHMENTS_WARNING_BYTES;
  const pdfEstimateText = pdfStats
    ? `Last generated PDF: ${formatBytes(pdfStats.sizeBytes)} · ${pdfStats.pageCount} pages`
    : "Generate a PDF to estimate size and page count.";
  const attachmentsEstimateText = `Attachments total: ${formatBytes(
    attachmentsTotalBytes,
  )}`;

  useEffect(() => {
    return () => {
      if (pdfUrl) {
        URL.revokeObjectURL(pdfUrl);
      }
    };
  }, [pdfUrl]);

  const updateField = <K extends keyof FormState>(
    field: K,
    value: FormState[K],
  ) => {
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

    const margin = 50;
    const defaultSize = 12;
    const lineGap = 6;
    const generatedAt = new Date().toLocaleString();
    const reasonValue = form.dispute_reason;
    const reasonText = getReasonLabel(reasonValue);
    const evidenceItemsForReason = buildEvidenceItems(
      reasonValue,
      form,
      attachments,
    );
    const evidenceByStrength = sortEvidenceByStrength(evidenceItemsForReason);
    const evidenceByPriority = sortEvidenceByPriority(evidenceItemsForReason);
    const strongestIncluded = evidenceByStrength
      .filter((item) => item.present)
      .slice(0, 3);
    const timelineHighlights = form.timeline
      .map((event) => normalizeTimelineEvent(event).trim())
      .filter(Boolean)
      .slice(0, 3);

    const coverPage = pdfDoc.addPage();
    const { height: coverHeight } = coverPage.getSize();
    let coverY = coverHeight - margin;

    const drawCoverLine = (text: string, size = defaultSize) => {
      coverPage.drawText(text, {
        x: margin,
        y: coverY,
        size,
        font,
        color: rgb(0, 0, 0),
      });
      coverY -= size + lineGap;
    };

    drawCoverLine("Chargeback Evidence", 20);
    coverY -= 6;
    drawCoverLine("Cover Summary", 16);
    drawCoverLine(`Dispute Reason: ${reasonText || "—"}`);
    coverY -= 6;
    drawCoverLine("Top evidence included", 14);
    if (strongestIncluded.length === 0) {
      drawCoverLine("No evidence items marked present yet.");
    } else {
      strongestIncluded.forEach((item) => {
        drawCoverLine(`• ${item.label}`);
      });
    }
    coverY -= 6;
    drawCoverLine("Timeline highlights", 14);
    if (timelineHighlights.length === 0) {
      drawCoverLine("No timeline events provided.");
    } else {
      timelineHighlights.forEach((event) => {
        drawCoverLine(`• ${event}`);
      });
    }

    let page = pdfDoc.addPage();
    const { height } = page.getSize();
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

    drawLine("Chargeback Evidence", 20);
    y -= 8;

    drawLine("Summary", 14);
    drawLine(`Merchant: ${form.merchant_name || "—"}`);
    drawLine(`Order ID: ${form.order_id || "—"}`);
    drawLine(`Dispute Reason: ${reasonText || "—"}`);
    drawLine(
      `Amount: ${form.amount ? `${form.amount} ${form.currency}` : "—"}`,
    );

    y -= 10;
    drawLine("Key Evidence Summary (Prioritized for Review)", 14);
    evidenceByStrength.forEach((item) => {
      drawLine(`• ${item.label} — ${item.present ? "Present" : "Missing"}`);
    });

    y -= 10;
    drawLine("Evidence Checklist", 14);
    evidenceByPriority.forEach((item) => {
      const priorityLabel =
        item.priority === "critical" ? "Critical" : "Recommended";
      drawLine(
        `• ${item.label} (${priorityLabel}) — ${
          item.present ? "Present" : "Missing"
        }`,
      );
    });

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

    pdfDoc.getPages().forEach((pdfPage) => {
      if (SHOW_BRANDING_FOOTER) {
        pdfPage.drawText("Generated by DisputeShield.app", {
          x: margin,
          y: 42,
          size: 9,
          font,
          color: rgb(0, 0, 0),
        });
      }

      pdfPage.drawText(`Generated by DisputeShield on ${generatedAt}`, {
        x: margin,
        y: 30,
        size: 10,
        font,
        color: rgb(0, 0, 0),
      });
    });

    const bytes = await pdfDoc.save();
    return { bytes, pageCount: pdfDoc.getPageCount() };
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

      const result = await createPdfBytes();
      setPdfBytes(result.bytes);
      setPdfStats({
        sizeBytes: result.bytes.length,
        pageCount: result.pageCount,
      });
      setPdfFromBytes(result.bytes);
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
        const result = await createPdfBytes();
        bytes = result.bytes;
        setPdfBytes(result.bytes);
        setPdfStats({
          sizeBytes: result.bytes.length,
          pageCount: result.pageCount,
        });
        setPdfFromBytes(result.bytes);
      }

      if (!hasAttachments) {
        setZipTip(
          "Tip: banks often prefer screenshots/PDFs of tracking, policies, and customer communications.",
        );
      }

      const checklistItems = sortEvidenceByPriority(evidenceItems);
      const checklistLines = checklistItems.map((item) => {
        const priorityLabel =
          item.priority === "critical" ? "Critical" : "Recommended";
        return `- ${item.label} (${priorityLabel}): ${
          item.present ? "Present" : "Missing"
        }`;
      });

      const summary = [
        `Merchant Name: ${form.merchant_name || "—"}`,
        `Order ID: ${form.order_id || "—"}`,
        `Amount: ${form.amount || "—"}`,
        `Currency: ${form.currency || "—"}`,
        `Dispute Reason: ${reasonLabel || "—"}`,
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

      const submissionNotesLines: string[] = [];
      submissionNotesLines.push(
        `Submission Summary: ${reasonLabel} dispute for order ${form.order_id || "—"} in the amount of ${form.amount || "—"} ${form.currency || ""}. Evidence packet includes timeline, policies, and supporting materials generated by the merchant.`,
      );
      submissionNotesLines.push("");
      submissionNotesLines.push("Attached evidence:");
      if (attachments.length === 0) {
        submissionNotesLines.push("- No attachments included.");
      } else {
        attachments.forEach((attachment) => {
          submissionNotesLines.push(`- ${attachment.file.name}`);
        });
      }
      submissionNotesLines.push("");
      submissionNotesLines.push("Timeline highlights:");
      if (form.timeline.length === 0) {
        submissionNotesLines.push("- No timeline events provided.");
      } else {
        form.timeline.forEach((event) => {
          submissionNotesLines.push(`- ${normalizeTimelineEvent(event)}`);
        });
      }
      if (hasValue(form.policy_url)) {
        submissionNotesLines.push("");
        submissionNotesLines.push("Policy link:");
        submissionNotesLines.push(form.policy_url.trim());
      }

      const submissionNotes = submissionNotesLines.join("\n");

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
      zip.file("submission-notes.txt", submissionNotes);
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
          <select
            id="dispute_reason"
            className={inputClassName}
            value={form.dispute_reason}
            onChange={(event) =>
              updateField(
                "dispute_reason",
                event.target.value as DisputeReason,
              )
            }
          >
            {DISPUTE_REASONS.map((reasonOption) => (
              <option key={reasonOption.value} value={reasonOption.value}>
                {reasonOption.label}
              </option>
            ))}
          </select>
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
          <h2 className="text-lg font-semibold text-slate-900">
            Recommended evidence
          </h2>
          <span className="text-xs text-slate-500">For {reasonLabel}</span>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {evidenceItems.map((item) => (
            <div
              key={item.id}
              className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm"
            >
              <div className="flex items-start gap-2">
                <span className="text-slate-700">{item.label}</span>
                <span title={item.tooltip} className="text-xs text-slate-400">
                  ?
                </span>
              </div>
              <span
                className={`text-xs font-semibold ${
                  item.priority === "critical"
                    ? "text-rose-600"
                    : "text-slate-500"
                }`}
              >
                {item.priority === "critical" ? "Critical" : "Recommended"}
              </span>
            </div>
          ))}
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
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">
            Evidence checklist
          </h2>
          <span className="text-xs text-slate-500">
            Critical vs recommended
          </span>
        </div>
        {showChecklistWarning && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
            2 or more recommended items are missing. Consider adding supporting
            evidence before exporting.
          </div>
        )}
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs font-semibold uppercase text-slate-500">
              Critical
            </p>
            {criticalEvidence.map((item) => (
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
          <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs font-semibold uppercase text-slate-500">
              Recommended
            </p>
            {recommendedEvidence.map((item) => (
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
        <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase text-slate-500">
              Export guardrails
            </span>
            <span>{pdfEstimateText}</span>
            <span>{attachmentsEstimateText}</span>
          </div>
          {showPdfLimitWarning && (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-700">
              Warning: this PDF may exceed common bank limits (2–3MB or high
              page count).
            </div>
          )}
          {showAttachmentSizeWarning && (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-700">
              Warning: attachments are large and may push the ZIP over upload
              limits.
            </div>
          )}
          {(showPdfLimitWarning || showAttachmentSizeWarning) && (
            <ul className="mt-3 list-disc space-y-1 pl-5 text-slate-600">
              <li>Consolidate screenshots into a single PDF.</li>
              <li>Include only the most relevant policy excerpts.</li>
              <li>Merge customer communications into one file.</li>
            </ul>
          )}
        </div>
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
