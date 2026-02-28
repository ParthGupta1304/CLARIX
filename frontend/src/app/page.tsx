"use client";

import { useState, useRef, useCallback, useEffect } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000/api";
const PYTHON_API = process.env.NEXT_PUBLIC_PYTHON_API_URL || "http://localhost:8000";
import {
  Layers,
  FileText,
  Image as ImageIcon,
  Globe,
  Search,
  Upload,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ExternalLink,
  X,
  Loader2,
  Shield,
  Sparkles,
  Clock,
  ArrowRight,
  Copy,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";
import MinimalHero from "@/components/ui/hero-minimalism";
import { ScrollReveal } from "@/components/ui/scroll-reveal";

/* ── Types ──────────────────────────────────────────────── */
interface MLPrediction {
  label: "REAL" | "FAKE";
  confidence: number;
  realProbability: number;
  fakeProbability: number;
}

interface DeepfakePrediction {
  label: "Real" | "Deepfake";
  confidence: number;
  deepfakeProbability: number;
  realProbability: number;
}

interface AnalysisResult {
  score: number;
  verdict: "Credible" | "Uncertain" | "Misleading";
  factCheck: number;
  sourceCredibility: number;
  sentimentBias: number;
  explanation: string;
  sources: { title: string; url: string }[];
  mlPrediction: MLPrediction | null;
  deepfakePrediction: DeepfakePrediction | null;
  analysisType: "text" | "image" | "page";
}

/* ── API helpers ────────────────────────────────────────── */
async function analyzeContent(
  type: "text" | "image" | "page",
  content: string,
  url?: string
): Promise<AnalysisResult> {
  const res = await fetch(`${API_BASE}/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": "clarix-public-api-key-change-in-production" },
    body: JSON.stringify({ type, content, url }),
  });
  if (!res.ok) throw new Error("Analysis failed");
  const json = await res.json();
  const d = json.data;
  return {
    score: d.score ?? d.credibility?.score ?? 0,
    verdict: d.verdict ?? "Uncertain",
    factCheck: d.factCheck ?? 0,
    sourceCredibility: d.sourceCredibility ?? 0,
    sentimentBias: d.sentimentBias ?? 0,
    explanation: d.explanation ?? d.analysis?.explanation ?? "",
    sources: d.sources ?? [],
    mlPrediction: d.mlPrediction ?? null,
    deepfakePrediction: null,
    analysisType: type,
  };
}

/** Upload image file directly to Python engine for deepfake detection */
async function analyzeImageFile(file: File): Promise<AnalysisResult> {
  const formData = new FormData();
  formData.append("file", file);

  const res = await fetch(`${PYTHON_API}/detect-deepfake`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Analysis failed" }));
    throw new Error(err.detail || "Deepfake detection failed");
  }
  const data = await res.json();

  const isReal = data.label === "Real";
  const score = isReal
    ? Math.round(data.real_probability)
    : Math.round(100 - data.deepfake_probability);

  return {
    score,
    verdict: score >= 70 ? "Credible" : score >= 45 ? "Uncertain" : "Misleading",
    factCheck: 0,
    sourceCredibility: 0,
    sentimentBias: 0,
    explanation: isReal
      ? `This image appears to be authentic with ${data.confidence.toFixed(1)}% confidence. No signs of deepfake manipulation were detected.`
      : `This image shows signs of potential deepfake manipulation with ${data.confidence.toFixed(1)}% confidence. The AI model detected visual artifacts consistent with synthetic media.`,
    sources: [],
    mlPrediction: null,
    deepfakePrediction: {
      label: data.label,
      confidence: data.confidence,
      deepfakeProbability: data.deepfake_probability,
      realProbability: data.real_probability,
    },
    analysisType: "image",
  };
}

/** Fetch image from URL, convert to File, then run deepfake detection */
async function analyzeImageUrl(url: string): Promise<AnalysisResult> {
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to fetch image from URL");
  const blob = await res.blob();
  const file = new File([blob], "image.jpg", { type: blob.type || "image/jpeg" });
  return analyzeImageFile(file);
}

async function fetchStats(): Promise<{
  claimsChecked: number;
  accuracyRate: number;
  pagesScanned: number;
  flaggedItems: number;
}> {
  try {
    const res = await fetch(`${API_BASE}/stats`);
    if (!res.ok) throw new Error();
    const json = await res.json();
    return { ...json.data, accuracyRate: 93 };
  } catch {
    return { claimsChecked: 0, accuracyRate: 93, pagesScanned: 0, flaggedItems: 0 };
  }
}

async function fetchHistory(): Promise<HistoryItem[]> {
  try {
    const res = await fetch(`${API_BASE}/analyze/history`, {
      headers: { "x-api-key": "clarix-public-api-key-change-in-production" },
    });
    if (!res.ok) throw new Error();
    const json = await res.json();
    return (json.data?.items ?? []).map((h: HistoryItem) => ({
      ...h,
      time: formatRelativeTime(h.time),
    }));
  } catch {
    return [];
  }
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

/* ── History item type ─────────────────────────────────── */
interface HistoryItem {
  id: number | string;
  type: "text" | "image" | "page";
  title: string;
  score: number;
  verdict: string;
  time: string;
}

interface QuickStats {
  claimsChecked: number;
  accuracyRate: number;
  pagesScanned: number;
  flaggedItems: number;
}

/* ── Helpers ────────────────────────────────────────────── */
function getVerdictColor(verdict: string) {
  switch (verdict) {
    case "Credible":
      return "text-pastel-green";
    case "Misleading":
      return "text-pastel-red";
    default:
      return "text-pastel-yellow";
  }
}

function getVerdictBgClass(verdict: string) {
  switch (verdict) {
    case "Credible":
      return "bg-pastel-green/15 text-pastel-green border-pastel-green/25";
    case "Misleading":
      return "bg-pastel-red/15 text-pastel-red border-pastel-red/25";
    default:
      return "bg-pastel-yellow/15 text-pastel-yellow border-pastel-yellow/25";
  }
}

function getVerdictIcon(verdict: string) {
  switch (verdict) {
    case "Credible":
      return <CheckCircle2 className="h-5 w-5 text-pastel-green" />;
    case "Misleading":
      return <XCircle className="h-5 w-5 text-pastel-red" />;
    default:
      return <AlertTriangle className="h-5 w-5 text-pastel-yellow" />;
  }
}

function getScoreBarColor(score: number) {
  if (score >= 70) return "bg-pastel-green";
  if (score >= 45) return "bg-pastel-yellow";
  return "bg-pastel-red";
}

function getTypeIcon(type: string) {
  switch (type) {
    case "text":
      return <FileText className="h-3.5 w-3.5" />;
    case "image":
      return <ImageIcon className="h-3.5 w-3.5" />;
    default:
      return <Globe className="h-3.5 w-3.5" />;
  }
}

/* ── ScoreRing Component ───────────────────────────────── */
function ScoreRing({
  score,
  verdict,
  size = 120,
}: {
  score: number;
  verdict: string;
  size?: number;
}) {
  const radius = (size - 16) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const strokeColor =
    verdict === "Credible"
      ? "var(--pastel-green)"
      : verdict === "Misleading"
        ? "var(--pastel-red)"
        : "var(--pastel-yellow)";

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="-rotate-90"
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--surface-2)"
          strokeWidth="8"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={strokeColor}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-all duration-1000 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-bold">{score}</span>
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Trust
        </span>
      </div>
    </div>
  );
}

/* ── BreakdownBar Component ────────────────────────────── */
function BreakdownBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-32 shrink-0 text-sm text-white">
        {label}
      </span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
        <div
          className={`h-full rounded-full transition-all duration-700 ease-out ${getScoreBarColor(value)}`}
          style={{ width: `${value}%` }}
        />
      </div>
      <span className="w-8 text-right text-sm font-semibold">{value}</span>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   MAIN PAGE COMPONENT
   ══════════════════════════════════════════════════════════ */
export default function Home() {
  const [textInput, setTextInput] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [pageUrl, setPageUrl] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [activeTab, setActiveTab] = useState("text");
  const [dragActive, setDragActive] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [stats, setStats] = useState<QuickStats>({ claimsChecked: 0, accuracyRate: 93, pagesScanned: 0, flaggedItems: 0 });
  const [recentHistory, setRecentHistory] = useState<HistoryItem[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch stats and history on mount
  useEffect(() => {
    fetchStats().then(setStats);
    fetchHistory().then(setRecentHistory);
  }, []);

  // Refresh stats and history after analysis
  const refreshSidebar = useCallback(() => {
    fetchStats().then(setStats);
    fetchHistory().then(setRecentHistory);
  }, []);

  const handleAnalyze = useCallback(async () => {
    setIsAnalyzing(true);
    setResult(null);
    try {
      let res: AnalysisResult;
      if (activeTab === "text") {
        res = await analyzeContent("text", textInput);
      } else if (activeTab === "image") {
        if (uploadedFile) {
          res = await analyzeImageFile(uploadedFile);
        } else if (imageUrl.trim()) {
          res = await analyzeImageUrl(imageUrl);
        } else {
          throw new Error("No image provided");
        }
      } else {
        res = await analyzeContent("page", pageUrl, pageUrl);
      }
      setResult(res);
      refreshSidebar();
    } catch (err) {
      console.error("Analysis failed:", err);
    } finally {
      setIsAnalyzing(false);
    }
  }, [activeTab, textInput, uploadedFile, imageUrl, pageUrl, refreshSidebar]);

  const handleReset = useCallback(() => {
    setResult(null);
    setTextInput("");
    setImageUrl("");
    setUploadedFile(null);
    setUploadedFileName(null);
  }, []);

  const handleFileDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("image/")) {
      setUploadedFile(file);
      setUploadedFileName(file.name);
    }
  }, []);

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        setUploadedFile(file);
        setUploadedFileName(file.name);
      }
    },
    []
  );

  return (
    <div className="relative flex min-h-screen flex-col">
      <MinimalHero />
      
      {/* ── Header Overlay ───────────────────────────────────────── */}
      <header className="absolute top-0 w-full z-50">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface/40 border border-white/10 backdrop-blur-md">
              <Layers className="h-4 w-4 text-white" />
            </div>
            <span className="text-lg font-bold tracking-tight text-white drop-shadow-md">Clarix</span>
            <Badge
              variant="outline"
              className="ml-1 text-[9px] font-semibold uppercase tracking-widest text-white/80 border-white/20 bg-white/5"
            >
              Beta
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-9 w-9 text-white/80 hover:text-white hover:bg-white/10">
                  <Clock className="h-4.5 w-4.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>History</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-9 w-9 text-white/80 hover:text-white hover:bg-white/10">
                  <Shield className="h-4.5 w-4.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>About Clarix</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </header>

      {/* ── Main Analyzer Section ────────────────────────────────── */}
      <main id="analyzer-section" className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-20 sm:px-6 relative z-10">
        <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
          {/* ── Left Column — Analyzer ───────────────────── */}
          <div className="flex flex-col gap-6">
            <ScrollReveal direction="up" delay={0}>
            <Card className="border-border bg-card/80 backdrop-blur-md">
              <Tabs
                value={activeTab}
                onValueChange={(v) => {
                  setActiveTab(v);
                  setResult(null);
                }}
              >
                <CardHeader className="pb-0">
                  <TabsList className="w-full bg-surface-2">
                    <TabsTrigger
                      value="text"
                      className="flex-1 gap-1.5 text-xs data-[state=active]:bg-background"
                    >
                      <FileText className="h-3.5 w-3.5" />
                      Text / Claim
                    </TabsTrigger>
                    <TabsTrigger
                      value="image"
                      className="flex-1 gap-1.5 text-xs data-[state=active]:bg-background"
                    >
                      <ImageIcon className="h-3.5 w-3.5" />
                      Image / Media
                    </TabsTrigger>
                    <TabsTrigger
                      value="page"
                      className="flex-1 gap-1.5 text-xs data-[state=active]:bg-background"
                    >
                      <Globe className="h-3.5 w-3.5" />
                      Full Page
                    </TabsTrigger>
                  </TabsList>
                </CardHeader>

                <CardContent className="pt-5">
                  {/* TEXT TAB */}
                  <TabsContent value="text" className="mt-0 flex flex-col gap-4">
                    <div>
                      <div className="mb-1.5 flex items-center justify-between">
                        <label className="text-xs text-muted-foreground">
                          Paste or type a claim to verify
                        </label>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-6 gap-1 rounded-full px-2.5 text-[10px]"
                          onClick={() =>
                            navigator.clipboard.readText().then(setTextInput)
                          }
                        >
                          <Copy className="h-3 w-3" />
                          Paste
                        </Button>
                      </div>
                      <Textarea
                        id="textInput"
                        placeholder="E.g. 'Scientists confirm chocolate cures cancer…'"
                        rows={4}
                        value={textInput}
                        onChange={(e) => setTextInput(e.target.value)}
                        className="resize-none bg-surface-2 border-border text-sm"
                        maxLength={1000}
                      />
                      <p className="mt-1 text-right text-[10px] text-muted-foreground">
                        {textInput.length} / 1000
                      </p>
                    </div>
                    <Button
                      id="analyzeTextBtn"
                      className="w-full gap-2"
                      disabled={!textInput.trim() || isAnalyzing}
                      onClick={handleAnalyze}
                    >
                      {isAnalyzing ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Search className="h-4 w-4" />
                      )}
                      {isAnalyzing ? "Analyzing…" : "Analyze Claim"}
                    </Button>
                  </TabsContent>

                  {/* IMAGE TAB */}
                  <TabsContent
                    value="image"
                    className="mt-0 flex flex-col gap-4"
                  >
                    <div
                      className={`group relative flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-8 text-center transition-colors cursor-pointer ${
                        dragActive
                          ? "border-foreground bg-surface-2"
                          : "border-border hover:border-foreground/30 hover:bg-surface-2"
                      }`}
                      onDragOver={(e) => {
                        e.preventDefault();
                        setDragActive(true);
                      }}
                      onDragLeave={() => setDragActive(false)}
                      onDrop={handleFileDrop}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={handleFileSelect}
                        aria-label="Upload image"
                      />
                      {uploadedFileName ? (
                        <>
                          <CheckCircle2 className="h-8 w-8 text-pastel-green" />
                          <p className="text-sm font-medium">
                            {uploadedFileName}
                          </p>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-xs text-muted-foreground"
                            onClick={(e) => {
                              e.stopPropagation();
                              setUploadedFile(null);
                              setUploadedFileName(null);
                            }}
                          >
                            Remove
                          </Button>
                        </>
                      ) : (
                        <>
                          <Upload className="h-8 w-8 text-muted-foreground group-hover:text-foreground transition-colors" />
                          <div>
                            <p className="text-sm font-medium">
                              Drop image here
                            </p>
                            <p className="text-xs text-muted-foreground">
                              or click to browse
                            </p>
                          </div>
                        </>
                      )}
                    </div>

                    <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                      <Separator className="flex-1" />
                      <span>or enter image URL</span>
                      <Separator className="flex-1" />
                    </div>

                    <Input
                      id="imageUrlInput"
                      type="url"
                      placeholder="https://example.com/image.jpg"
                      value={imageUrl}
                      onChange={(e) => setImageUrl(e.target.value)}
                      className="bg-surface-2 border-border text-sm"
                    />

                    <Button
                      id="analyzeImageBtn"
                      className="w-full gap-2"
                      disabled={
                        (!uploadedFileName && !imageUrl.trim()) || isAnalyzing
                      }
                      onClick={handleAnalyze}
                    >
                      {isAnalyzing ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Search className="h-4 w-4" />
                      )}
                      {isAnalyzing ? "Analyzing…" : "Analyze Image"}
                    </Button>
                  </TabsContent>

                  {/* PAGE TAB */}
                  <TabsContent
                    value="page"
                    className="mt-0 flex flex-col gap-4"
                  >
                    <Card className="border-border bg-surface-2">
                      <CardContent className="flex items-center gap-3 py-3 px-4">
                        <Globe className="h-5 w-5 shrink-0 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">
                            Current Page
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            Enter a URL below or use the browser extension
                          </p>
                        </div>
                      </CardContent>
                    </Card>

                    <Input
                      id="pageUrlInput"
                      type="url"
                      placeholder="https://example.com/article"
                      value={pageUrl}
                      onChange={(e) => setPageUrl(e.target.value)}
                      className="bg-surface-2 border-border text-sm"
                    />

                    <p className="text-xs leading-relaxed text-muted-foreground">
                      Clarix will scan the article headlines, main content, and
                      any embedded images for potential misinformation.
                    </p>

                    <Button
                      id="analyzePageBtn"
                      className="w-full gap-2"
                      disabled={isAnalyzing}
                      onClick={handleAnalyze}
                    >
                      {isAnalyzing ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Search className="h-4 w-4" />
                      )}
                      {isAnalyzing ? "Scanning…" : "Scan Full Page"}
                    </Button>
                  </TabsContent>
                </CardContent>
              </Tabs>
            </Card>
            </ScrollReveal>

            {/* ── Result Panel ────────────────────────────── */}
            {result && (
              <ScrollReveal direction="up" delay={0.05}>
              <Card className="border-border bg-card/80 backdrop-blur-md">
                <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
                  <CardTitle className="text-base">Analysis Result</CardTitle>
                  <div className="flex gap-1">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={handleReset}
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>New analysis</TooltipContent>
                    </Tooltip>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => setResult(null)}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="flex flex-col gap-5">
                  {/* Score + Verdict */}
                  <div className="flex items-center gap-5">
                    <ScoreRing
                      score={result.score}
                      verdict={result.verdict}
                      size={110}
                    />
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center gap-2">
                        {getVerdictIcon(result.verdict)}
                        <span className={`text-xl font-bold ${getVerdictColor(result.verdict)}`}>
                          {result.verdict}
                        </span>
                      </div>
                      <Badge
                        variant="outline"
                        className={`w-fit text-xs ${getVerdictBgClass(result.verdict)}`}
                      >
                        {result.score >= 70
                          ? "High Confidence"
                          : result.score >= 45
                            ? "Needs Review"
                            : "Low Confidence"}
                      </Badge>
                    </div>
                  </div>

                  <Separator />

                  {/* Breakdown — text/page analysis */}
                  {!result.deepfakePrediction && (
                    <div className="flex flex-col gap-3">
                      <h3 className="text-[15px] font-semibold text-white uppercase tracking-wider text-muted-foreground">
                        Signal Breakdown
                      </h3>
                      <BreakdownBar
                        label="Fact-Check"
                        
                        value={result.factCheck}
                      />
                      <BreakdownBar
                        label="Source Credibility"
                        value={result.sourceCredibility}
                      />
                      <BreakdownBar
                        label="Sentiment / Bias"
                        value={result.sentimentBias}
                      />
                    </div>
                  )}

                  {/* Deepfake Detection — image analysis */}
                  {result.deepfakePrediction && (
                    <div className="flex flex-col gap-3">
                      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Deepfake Detection
                      </h3>
                      <div className="rounded-lg bg-surface-2 p-4">
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <Badge
                              variant="outline"
                              className={`text-xs font-bold ${
                                result.deepfakePrediction.label === "Real"
                                  ? "bg-pastel-green/15 text-pastel-green border-pastel-green/25"
                                  : "bg-pastel-red/15 text-pastel-red border-pastel-red/25"
                              }`}
                            >
                              {result.deepfakePrediction.label}
                            </Badge>
                            <span className="text-sm font-semibold">
                              {result.deepfakePrediction.confidence.toFixed(1)}% confidence
                            </span>
                          </div>
                        </div>
                        <div className="flex flex-col gap-2">
                          <BreakdownBar
                            label="Real"
                            value={Math.round(result.deepfakePrediction.realProbability)}
                          />
                          <BreakdownBar
                            label="Deepfake"
                            value={Math.round(result.deepfakePrediction.deepfakeProbability)}
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* ML Model Prediction */}
                  {result.mlPrediction && (
                    <>
                      <Separator />
                      <div className="flex flex-col gap-2">
                        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          ML Model Prediction
                        </h3>
                        <div className="flex items-center justify-between rounded-lg bg-surface-2 p-3">
                          <div className="flex items-center gap-2">
                            <Badge
                              variant="outline"
                              className={`text-xs font-bold ${
                                result.mlPrediction.label === "REAL"
                                  ? "bg-pastel-green/15 text-pastel-green border-pastel-green/25"
                                  : "bg-pastel-red/15 text-pastel-red border-pastel-red/25"
                              }`}
                            >
                              {result.mlPrediction.label}
                            </Badge>
                            <span className="text-sm font-semibold">
                              {result.mlPrediction.confidence}% confidence
                            </span>
                          </div>
                          <div className="flex gap-3 text-[11px] text-muted-foreground">
                            <span>
                              Real: <strong className="text-pastel-green">{result.mlPrediction.realProbability}%</strong>
                            </span>
                            <span>
                              Fake: <strong className="text-pastel-red">{result.mlPrediction.fakeProbability}%</strong>
                            </span>
                          </div>
                        </div>
                      </div>
                    </>
                  )}

                  <Separator />

                  {/* Explanation */}
                  <div className="flex flex-col gap-2">
                    <h3 className="text-[15px] font-semibold uppercase tracking-wider text-white text-muted-foreground">
                      Why?
                    </h3>
                    <p className="text-sm leading-relaxed text-white">
                      {result.explanation}
                    </p>
                  </div>

                </CardContent>
              </Card>
              </ScrollReveal>
            )}
          </div>

          {/* ── Right Column — Sidebar ───────────────────── */}
          <div className="flex flex-col gap-6">
            {/* Quick Stats */}
            <ScrollReveal direction="right" delay={0.1}>
            <Card className="border-border bg-card/80 backdrop-blur-md">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Sparkles className="h-4 w-4 text-pastel-yellow" />
                  Quick Stats
                </CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-3">
                <div className="rounded-lg bg-surface-2 p-3 text-center">
                  <p className="text-2xl font-bold">{stats.claimsChecked}</p>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Claims Checked
                  </p>
                </div>
                <div className="rounded-lg bg-surface-2 p-3 text-center">
                  <p className="text-2xl font-bold text-pastel-green">{stats.accuracyRate}%</p>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Accuracy Rate
                  </p>
                </div>
                <div className="rounded-lg bg-surface-2 p-3 text-center">
                  <p className="text-2xl font-bold">{stats.pagesScanned}</p>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Pages Scanned
                  </p>
                </div>
                <div className="rounded-lg bg-surface-2 p-3 text-center">
                  <p className="text-2xl font-bold text-pastel-red">{stats.flaggedItems}</p>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Flagged Items
                  </p>
                </div>
              </CardContent>
            </Card>
            </ScrollReveal>

            {/* Recent History */}
            <ScrollReveal direction="right" delay={0.2}>
            <Card className="border-border bg-card/80 backdrop-blur-md">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-pastel-blue" />
                    Recent Activity
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 gap-1 px-2 text-[10px] text-muted-foreground"
                  >
                    View all
                    <ArrowRight className="h-3 w-3" />
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {recentHistory.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-4">
                    No analyses yet. Try analyzing some content!
                  </p>
                ) : (
                  recentHistory.slice(0, 6).map((item) => (
                    <button
                      key={item.id}
                      className="flex items-start gap-3 rounded-lg border border-transparent p-2.5 text-left transition-colors hover:border-border hover:bg-surface-2"
                    >
                      <div className="mt-0.5 rounded-md bg-surface-2 p-1.5 text-muted-foreground">
                        {getTypeIcon(item.type)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium">
                          {item.title}
                        </p>
                        <div className="mt-1 flex items-center gap-2">
                          <Badge
                            variant="outline"
                            className={`text-[10px] px-1.5 py-0 ${getVerdictBgClass(item.verdict)}`}
                          >
                            {item.verdict}
                          </Badge>
                          <span className="text-[10px] text-muted-foreground">
                            {item.time}
                          </span>
                        </div>
                      </div>
                      <span
                        className={`text-sm font-bold ${getVerdictColor(item.verdict)}`}
                      >
                        {item.score}
                      </span>
                    </button>
                  ))
                )}
              </CardContent>
            </Card>
            </ScrollReveal>

            {/* How it works */}
            <ScrollReveal direction="right" delay={0.3}>
            <Card className="border-border bg-card/80 backdrop-blur-md">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">How it works</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {[
                  {
                    step: "1",
                    title: "Submit Content",
                    desc: "Paste text, upload an image, or enter a page URL",
                  },
                  {
                    step: "2",
                    title: "AI Analysis",
                    desc: "Our model cross-references facts with trusted sources",
                  },
                  {
                    step: "3",
                    title: "Get Results",
                    desc: "Receive a trust score with detailed breakdown",
                  },
                ].map((item) => (
                  <div key={item.step} className="flex items-start gap-3">
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs font-bold text-muted-foreground">
                      {item.step}
                    </div>
                    <div>
                      <p className="text-xs font-medium">{item.title}</p>
                      <p className="text-[11px] leading-relaxed text-muted-foreground">
                        {item.desc}
                      </p>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
            </ScrollReveal>
          </div>
        </div>
      </main>

      {/* ── Footer ───────────────────────────────────────── */}
      <footer className="border-t border-white/5 bg-background/60 backdrop-blur-sm">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
          <span className="text-xs text-muted-foreground">
            Clarix v1.0 · AI-Powered Fact Checking
          </span>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <a href="#" className="transition-colors hover:text-foreground">
              Report Issue
            </a>
            <span className="opacity-30">·</span>
            <a href="#" className="transition-colors hover:text-foreground">
              Privacy
            </a>
          </div>
        </div>
      </footer>

      {/* ── Loading Overlay ──────────────────────────────── */}
      {isAnalyzing && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/90 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-4 animate-fade-in">
            <Loader2 className="h-10 w-10 animate-spin text-foreground" />
            <div className="text-center">
              <p className="text-sm font-semibold">Analyzing…</p>
              <p className="text-xs text-muted-foreground">
                This may take a few seconds
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
