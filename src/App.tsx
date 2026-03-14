/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useCallback, useRef } from 'react';
import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { 
  Upload, 
  FileText, 
  AlertTriangle, 
  CheckCircle2, 
  Loader2, 
  RefreshCw,
  Download,
  Eye,
  ChevronRight,
  Terminal,
  Database,
  ArrowUp,
  ArrowDown,
  MessageSquare,
  Image as ImageIcon,
  Bot,
  User,
  Send,
  Sparkles,
  Zap
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Markdown from 'react-markdown';

// --- Types ---

interface ExtractionResult {
  vendor_metadata?: {
    name?: string;
    address?: string;
    tax_id?: string;
    invoice_number?: string;
    date?: string;
  };
  transaction_line_items?: Array<{
    description: string;
    quantity?: number;
    unit_price?: number;
    sku?: string;
    total?: number;
    confidence_score?: number;
  }>;
  tax_regulatory_data?: {
    subtotal?: number;
    tax_amount?: number;
    surcharges?: number;
    grand_total?: number;
    currency?: string;
  };
  uncertain_extractions?: Array<{
    field: string;
    value: any;
    confidence_score: number;
    reason: string;
  }>;
  validation_errors?: string[];
}

type Tab = 'parser' | 'chat' | 'image-gen';

interface ChatMessage {
  role: 'user' | 'model';
  text: string;
  isThinking?: boolean;
}

// --- Constants ---

const SYSTEM_INSTRUCTION = `Act as an Unstructured Financial Intelligence Layer designed specifically to solve the "Test Your Own Document" challenge by parsing broken, scanned, or poorly formatted financial PDFs and images that typically break standard OCR pipelines. Your objective is to perform "Semantic Document Reconstruction": identify and extract high-fidelity data from messy vendor invoices, multi-page tax forms, and unstructured insurance claims where column alignment is lost or text overlaps. You must treat the input as a spatial map, using visual context to associate "floating" numerical values with their correct labels (e.g., assigning a disconnected "Balance Due" at the bottom of a page to the primary invoice header). Execute a strict "Financial Integrity Protocol": (1) Reconstruct nested tables by identifying row-level relationships even when borders are missing; (2) Perform recursive mathematical validation where Σ(Line Items) + Tax + Surcharges = Grand Total; (3) Explicitly flag "Data Anomalies" such as character substitutions (e.g., 'S' for '5' or 'O' for '0') by cross-referencing totals. Output the result in a clean, machine-readable JSON format with standardized keys for vendor_metadata, transaction_line_items (including unit price, quantity, SKU, and a confidence_score between 0 and 1 for each item), and tax_regulatory_data. If the document is a complex tax form like the 1040, normalize all inputs to their respective IRS field codes. If any part of the document is illegible or logically inconsistent with the calculated totals, do not hallucinate; instead, provide the most likely value in an uncertain_extractions field with a confidence score and a description of the layout failure.`;

// --- Components ---

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<ExtractionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('parser');
  
  // Chat State
  const [chatInput, setChatInput] = useState('');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [useThinking, setUseThinking] = useState(false);

  // Image Gen State
  const [imagePrompt, setImagePrompt] = useState('');
  const [aspectRatio, setAspectRatio] = useState('1:1');
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [isFloatingChatOpen, setIsFloatingChatOpen] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  React.useEffect(() => {
    if (activeTab === 'chat') scrollToBottom();
  }, [chatMessages, activeTab]);

  const handleChatSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || isChatLoading) return;

    const userMsg: ChatMessage = { role: 'user', text: chatInput };
    setChatMessages(prev => [...prev, userMsg]);
    setChatInput('');
    setIsChatLoading(true);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
      const config: any = {
        systemInstruction: `You are a financial intelligence assistant. ${result ? `The user has uploaded a document which has been parsed with the following results: ${JSON.stringify(result)}. You can help the user analyze this data, explain line items, or perform calculations based on it.` : "You help users analyze financial documents and data."}`
      };
      if (useThinking) {
        config.thinkingConfig = { thinkingLevel: ThinkingLevel.HIGH };
      }

      const response = await ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: [...chatMessages, userMsg].map(m => ({
          role: m.role,
          parts: [{ text: m.text }]
        })),
        config
      });

      setChatMessages(prev => [...prev, { role: 'model', text: response.text || 'No response', isThinking: useThinking }]);
    } catch (err) {
      console.error("Chat error:", err);
      setChatMessages(prev => [...prev, { role: 'model', text: "Error: Failed to generate response." }]);
    } finally {
      setIsChatLoading(false);
    }
  };

  const handleImageGen = async () => {
    if (!imagePrompt.trim() || isGeneratingImage) return;

    setIsGeneratingImage(true);
    setGeneratedImage(null);

    try {
      // Check for API key selection for Pro models
      if (!(await (window as any).aistudio.hasSelectedApiKey())) {
        await (window as any).aistudio.openSelectKey();
      }

      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || process.env.GEMINI_API_KEY! });
      
      const response = await ai.models.generateContent({
        model: 'gemini-3-pro-image-preview',
        contents: [{ text: imagePrompt }],
        config: {
          imageConfig: {
            aspectRatio: aspectRatio as any,
            imageSize: "1K"
          }
        }
      });

      for (const part of response.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData) {
          setGeneratedImage(`data:image/png;base64,${part.inlineData.data}`);
          break;
        }
      }
    } catch (err) {
      console.error("Image Gen error:", err);
      setError("Failed to generate image. Ensure you have selected a valid API key for Pro models.");
    } finally {
      setIsGeneratingImage(false);
    }
  };

  const EXAMPLE_PROMPTS = [
    {
      title: "Market Dashboard",
      prompt: "A futuristic dashboard showing real-time stock market trends with neon green and red line charts on a dark glass interface, high detail, 8k."
    },
    {
      title: "Balance Sheet 3D",
      prompt: "A professional 3D isometric infographic of a corporate balance sheet, showing assets, liabilities, and equity as interconnected glowing blocks, clean studio lighting."
    },
    {
      title: "Revenue Blueprint",
      prompt: "A minimalist bar chart representing quarterly revenue growth, styled like a high-end architectural blueprint on cream paper, technical drawing aesthetic."
    },
    {
      title: "Global Heatmap",
      prompt: "A complex heat map of global financial transactions, with glowing nodes and data streams connecting major financial hubs, dark blue and gold color palette."
    }
  ];

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      processFile(selectedFile);
    }
  };

  const processFile = (selectedFile: File) => {
    setFile(selectedFile);
    const url = URL.createObjectURL(selectedFile);
    setPreviewUrl(url);
    setResult(null);
    setError(null);
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const droppedFile = e.dataTransfer.files?.[0];
    if (droppedFile && droppedFile.type.startsWith('image/')) {
      processFile(droppedFile);
    } else {
      setError("Please upload an image file.");
    }
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const base64 = (reader.result as string).split(',')[1];
        resolve(base64);
      };
      reader.onerror = (error) => reject(error);
    });
  };

  const runExtraction = async () => {
    if (!file) return;

    setIsProcessing(true);
    setError(null);

    try {
      if (!process.env.GEMINI_API_KEY) {
        throw new Error("API_KEY_MISSING: Gemini API key is not configured. Please check your environment settings.");
      }

      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const base64Data = await fileToBase64(file);

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [
          { text: "Analyze this document and extract the financial data as specified in the system instructions." },
          {
            inlineData: {
              mimeType: file.type,
              data: base64Data,
            },
          },
        ],
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          responseMimeType: "application/json",
        },
      });

      const text = response.text;
      if (text) {
        try {
          const parsed = JSON.parse(text) as ExtractionResult;
          setResult(parsed);
        } catch (parseErr) {
          console.error("JSON Parse Error:", parseErr, "Raw Text:", text);
          throw new Error("PARSING_ERROR: The model returned an invalid JSON structure. This can happen with extremely messy documents.");
        }
      } else {
        throw new Error("EMPTY_RESPONSE: The model was unable to generate a response for this document.");
      }
    } catch (err: any) {
      console.error("Extraction error:", err);
      let userMessage = err.message || "An unexpected error occurred during document analysis.";
      
      if (userMessage.includes("fetch")) {
        userMessage = "NETWORK_ERROR: Unable to connect to the AI service. Please check your internet connection.";
      } else if (userMessage.includes("API key")) {
        userMessage = "AUTH_ERROR: Invalid API key. Please verify your Gemini API credentials.";
      } else if (userMessage.includes("safety")) {
        userMessage = "SAFETY_BLOCK: The document content was flagged by safety filters and could not be processed.";
      }

      setError(userMessage);
    } finally {
      setIsProcessing(false);
    }
  };

  const downloadJson = () => {
    if (!result) return;
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(result, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", `extraction_${file?.name.split('.')[0] || 'data'}.json`);
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
  };

  const reset = () => {
    setFile(null);
    setPreviewUrl(null);
    setResult(null);
    setError(null);
    setSortConfig(null);
  };

  const handleSort = (key: string) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  const sortedLineItems = React.useMemo(() => {
    if (!result?.transaction_line_items) return [];
    const items = [...result.transaction_line_items];
    if (sortConfig !== null) {
      items.sort((a: any, b: any) => {
        if (a[sortConfig.key] < b[sortConfig.key]) {
          return sortConfig.direction === 'asc' ? -1 : 1;
        }
        if (a[sortConfig.key] > b[sortConfig.key]) {
          return sortConfig.direction === 'asc' ? 1 : -1;
        }
        return 0;
      });
    }
    return items;
  }, [result?.transaction_line_items, sortConfig]);

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b border-[#141414] p-6 flex justify-between items-center bg-[#E4E3E0] sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <div className="bg-[#141414] text-[#E4E3E0] p-2 rounded-sm">
            <Terminal size={24} />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tighter uppercase">TYOD Intelligence Hub</h1>
            <p className="text-[10px] mono-text opacity-60">Multi-Modal Financial Analysis Suite v2.0</p>
          </div>
        </div>
        
        <nav className="hidden md:flex items-center gap-1 bg-[#141414]/5 p-1 rounded-sm border border-[#141414]/10">
          <button 
            onClick={() => setActiveTab('parser')}
            className={`px-4 py-1.5 text-[10px] mono-text font-bold uppercase transition-all rounded-sm flex items-center gap-2 ${activeTab === 'parser' ? 'bg-[#141414] text-[#E4E3E0]' : 'hover:bg-[#141414]/10'}`}
          >
            <Database size={12} /> Parser
          </button>
          <button 
            onClick={() => setActiveTab('chat')}
            className={`px-4 py-1.5 text-[10px] mono-text font-bold uppercase transition-all rounded-sm flex items-center gap-2 ${activeTab === 'chat' ? 'bg-[#141414] text-[#E4E3E0]' : 'hover:bg-[#141414]/10'}`}
          >
            <MessageSquare size={12} /> Chat
          </button>
          <button 
            onClick={() => setActiveTab('image-gen')}
            className={`px-4 py-1.5 text-[10px] mono-text font-bold uppercase transition-all rounded-sm flex items-center gap-2 ${activeTab === 'image-gen' ? 'bg-[#141414] text-[#E4E3E0]' : 'hover:bg-[#141414]/10'}`}
          >
            <ImageIcon size={12} /> Studio
          </button>
        </nav>

        <div className="flex items-center gap-4">
          {file && (
            <button 
              onClick={reset}
              className="text-[10px] mono-text hover:underline flex items-center gap-1"
            >
              <RefreshCw size={12} /> Reset
            </button>
          )}
          <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-[10px] mono-text">System Online</span>
        </div>
      </header>

      <main className="flex-1 flex flex-col overflow-hidden">
        <AnimatePresence mode="wait">
          {activeTab === 'parser' && (
            <motion.div 
              key="parser"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="flex-1 flex flex-col lg:flex-row overflow-hidden"
            >
              {/* Left Panel: Input/Preview */}
              <section className="flex-1 border-r border-[#141414] bg-[#DCDAD7] overflow-y-auto p-8">
                <AnimatePresence mode="wait">
                  {!file ? (
                    <motion.div 
                      key="upload"
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      className="h-full flex flex-col items-center justify-center"
                    >
                      <div 
                        onDragOver={onDragOver}
                        onDrop={onDrop}
                        onClick={() => fileInputRef.current?.click()}
                        className="w-full max-w-xl aspect-video border-2 border-dashed border-[#141414]/20 rounded-lg flex flex-col items-center justify-center gap-4 cursor-pointer hover:bg-[#141414]/5 transition-colors group"
                      >
                        <div className="p-6 rounded-full bg-[#141414]/5 group-hover:scale-110 transition-transform">
                          <Upload className="text-[#141414]" size={48} />
                        </div>
                        <div className="text-center">
                          <p className="font-bold text-lg">Drop document here</p>
                          <p className="text-sm opacity-60">or click to browse (PNG, JPG, WEBP)</p>
                        </div>
                        <input 
                          type="file" 
                          ref={fileInputRef} 
                          onChange={handleFileChange} 
                          accept="image/*" 
                          className="hidden" 
                        />
                      </div>
                      
                      <div className="mt-12 grid grid-cols-3 gap-8 w-full max-w-xl">
                        <div className="flex flex-col gap-2">
                          <Eye size={16} className="opacity-40" />
                          <p className="text-[10px] mono-text font-bold">Semantic Vision</p>
                          <p className="text-[10px] leading-relaxed opacity-60">Heals broken tables and overlapping text via spatial mapping.</p>
                        </div>
                        <div className="flex flex-col gap-2">
                          <Database size={16} className="opacity-40" />
                          <p className="text-[10px] mono-text font-bold">Integrity Protocol</p>
                          <p className="text-[10px] leading-relaxed opacity-60">Recursive math validation for line items and tax surcharges.</p>
                        </div>
                        <div className="flex flex-col gap-2">
                          <AlertTriangle size={16} className="opacity-40" />
                          <p className="text-[10px] mono-text font-bold">Anomaly Detection</p>
                          <p className="text-[10px] leading-relaxed opacity-60">Flags character substitutions and logical inconsistencies.</p>
                        </div>
                      </div>
                    </motion.div>
                  ) : (
                    <motion.div 
                      key="preview"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="flex flex-col gap-6"
                    >
                      <div className="flex justify-between items-end">
                        <div>
                          <p className="text-[10px] mono-text opacity-60">Active Document</p>
                          <h2 className="text-2xl font-bold tracking-tighter">{file.name}</h2>
                        </div>
                        {!result && !isProcessing && (
                          <button 
                            onClick={runExtraction}
                            className="bg-[#141414] text-[#E4E3E0] px-6 py-3 rounded-sm font-bold text-sm flex items-center gap-2 hover:bg-[#2a2a2a] transition-colors"
                          >
                            Process Document <ChevronRight size={16} />
                          </button>
                        )}
                      </div>

                      <div className="relative group">
                        <img 
                          src={previewUrl!} 
                          alt="Document Preview" 
                          className="w-full rounded-sm border border-[#141414] shadow-2xl"
                          referrerPolicy="no-referrer"
                        />
                        {isProcessing && (
                          <div className="absolute inset-0 bg-[#141414]/60 backdrop-blur-sm flex flex-col items-center justify-center text-[#E4E3E0] gap-4">
                            <Loader2 className="animate-spin" size={48} />
                            <div className="text-center">
                              <p className="mono-text font-bold text-lg">Analyzing Spatial Map...</p>
                              <p className="text-xs opacity-60">Reconstructing semantic relationships</p>
                            </div>
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </section>

              {/* Right Panel: Results */}
              <section className="flex-1 bg-[#E4E3E0] overflow-y-auto">
                {!result && !isProcessing && !error && (
                  <div className="h-full flex flex-col items-center justify-center p-12 text-center opacity-20">
                    <FileText size={64} strokeWidth={1} />
                    <p className="mt-4 mono-text">Extraction results will appear here</p>
                  </div>
                )}

                {error && (
                  <div className="p-8 h-full flex items-center justify-center">
                    <motion.div 
                      initial={{ scale: 0.9, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      className="max-w-md w-full bg-[#141414] text-[#E4E3E0] p-8 rounded-sm border border-red-500/50 shadow-2xl space-y-6"
                    >
                      <div className="flex items-center gap-4 text-red-500">
                        <AlertTriangle size={32} />
                        <h3 className="text-xl font-bold uppercase tracking-tighter">Extraction Failed</h3>
                      </div>
                      
                      <div className="space-y-2">
                        <div className="flex justify-between items-center">
                          <p className="text-[10px] mono-text opacity-40">Error Diagnostics</p>
                          <button 
                            onClick={() => {
                              navigator.clipboard.writeText(error || "");
                            }}
                            className="text-[9px] mono-text opacity-40 hover:opacity-100 transition-opacity"
                          >
                            Copy Code
                          </button>
                        </div>
                        <div className="bg-white/5 p-4 rounded-sm font-mono text-xs border border-white/10 break-words">
                          {error}
                        </div>
                      </div>

                      <div className="pt-4 flex flex-col gap-3">
                        <button 
                          onClick={runExtraction}
                          className="w-full bg-red-600 hover:bg-red-700 text-white py-4 rounded-sm font-bold flex items-center justify-center gap-2 transition-colors uppercase tracking-widest text-xs"
                        >
                          <RefreshCw size={16} /> Re-Attempt Analysis
                        </button>
                        <button 
                          onClick={reset}
                          className="w-full border border-white/20 hover:bg-white/5 text-white/60 py-3 rounded-sm font-bold text-[10px] mono-text transition-colors"
                        >
                          Discard & Try Different File
                        </button>
                      </div>
                    </motion.div>
                  </div>
                )}

                {result && (
                  <motion.div 
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="p-8 space-y-8"
                  >
                    {/* Status Banner */}
                    <div className="flex items-center justify-between border-b border-[#141414] pb-4">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="text-emerald-600" size={20} />
                        <span className="font-bold uppercase tracking-tight">Reconstruction Complete</span>
                      </div>
                      <button 
                        onClick={downloadJson}
                        className="text-[10px] mono-text flex items-center gap-1 hover:underline"
                      >
                        <Download size={12} /> Export JSON
                      </button>
                    </div>

                    {/* Vendor Metadata */}
                    {result.vendor_metadata && (
                      <div className="space-y-3">
                        <h3 className="text-[10px] mono-text font-bold opacity-40">Vendor Metadata</h3>
                        <div className="data-grid">
                          <div className="data-cell">
                            <p className="text-[10px] mono-text opacity-40">Entity Name</p>
                            <p className="font-bold">{result.vendor_metadata.name || 'N/A'}</p>
                          </div>
                          <div className="data-cell">
                            <p className="text-[10px] mono-text opacity-40">Tax ID / Reg</p>
                            <p className="font-bold">{result.vendor_metadata.tax_id || 'N/A'}</p>
                          </div>
                          <div className="data-cell">
                            <p className="text-[10px] mono-text opacity-40">Document ID</p>
                            <p className="font-bold">{result.vendor_metadata.invoice_number || 'N/A'}</p>
                          </div>
                          <div className="data-cell">
                            <p className="text-[10px] mono-text opacity-40">Timestamp</p>
                            <p className="font-bold">{result.vendor_metadata.date || 'N/A'}</p>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Line Items Table */}
                    {result.transaction_line_items && result.transaction_line_items.length > 0 && (
                      <div className="space-y-3">
                        <h3 className="text-[10px] mono-text font-bold opacity-40">Transaction Line Items</h3>
                        <div className="border border-[#141414] overflow-hidden rounded-sm">
                          <table className="w-full text-left text-xs">
                            <thead className="bg-[#141414] text-[#E4E3E0] uppercase text-[9px] mono-text">
                              <tr>
                                <th 
                                  className="p-3 cursor-pointer hover:bg-[#2a2a2a] transition-colors"
                                  onClick={() => handleSort('description')}
                                >
                                  <div className="flex items-center gap-1">
                                    Description
                                    {sortConfig?.key === 'description' && (
                                      sortConfig.direction === 'asc' ? <ArrowUp size={10} /> : <ArrowDown size={10} />
                                    )}
                                  </div>
                                </th>
                                <th 
                                  className="p-3 text-right cursor-pointer hover:bg-[#2a2a2a] transition-colors"
                                  onClick={() => handleSort('quantity')}
                                >
                                  <div className="flex items-center justify-end gap-1">
                                    Qty
                                    {sortConfig?.key === 'quantity' && (
                                      sortConfig.direction === 'asc' ? <ArrowUp size={10} /> : <ArrowDown size={10} />
                                    )}
                                  </div>
                                </th>
                                <th 
                                  className="p-3 text-right cursor-pointer hover:bg-[#2a2a2a] transition-colors"
                                  onClick={() => handleSort('unit_price')}
                                >
                                  <div className="flex items-center justify-end gap-1">
                                    Unit Price
                                    {sortConfig?.key === 'unit_price' && (
                                      sortConfig.direction === 'asc' ? <ArrowUp size={10} /> : <ArrowDown size={10} />
                                    )}
                                  </div>
                                </th>
                                <th 
                                  className="p-3 text-right cursor-pointer hover:bg-[#2a2a2a] transition-colors"
                                  onClick={() => handleSort('total')}
                                >
                                  <div className="flex items-center justify-end gap-1">
                                    Total
                                    {sortConfig?.key === 'total' && (
                                      sortConfig.direction === 'asc' ? <ArrowUp size={10} /> : <ArrowDown size={10} />
                                    )}
                                  </div>
                                </th>
                                <th className="p-3 text-right">Reliability</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-[#141414]/10">
                              {sortedLineItems.map((item, idx) => {
                                const score = item.confidence_score ?? 1;
                                const barColor = score > 0.7 ? 'bg-emerald-500' : score < 0.4 ? 'bg-red-500' : 'bg-amber-500';
                                
                                return (
                                  <tr key={idx} className="hover:bg-white/40 transition-colors">
                                    <td className="p-3 font-medium">{item.description}</td>
                                    <td className="p-3 text-right font-mono">{item.quantity ?? '-'}</td>
                                    <td className="p-3 text-right font-mono">{item.unit_price?.toFixed(2) ?? '-'}</td>
                                    <td className="p-3 text-right font-bold font-mono">{item.total?.toFixed(2) ?? '-'}</td>
                                    <td className="p-3 text-right">
                                      <div className="flex flex-col items-end gap-1">
                                        <span className="text-[8px] mono-text opacity-40">{(score * 100).toFixed(0)}%</span>
                                        <div className="h-1 w-12 bg-black/5 rounded-full overflow-hidden">
                                          <div 
                                            className={`h-full ${barColor}`}
                                            style={{ width: `${score * 100}%` }}
                                          />
                                        </div>
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {/* Financial Totals */}
                    {result.tax_regulatory_data && (
                      <div className="flex flex-col lg:flex-row gap-8">
                        <div className="flex-1 space-y-3">
                          <h3 className="text-[10px] mono-text font-bold opacity-40">Integrity Validation</h3>
                          <div className="bg-[#141414] text-[#E4E3E0] p-6 rounded-sm space-y-4">
                            <div className="flex justify-between items-center text-sm">
                              <span className="opacity-60">Subtotal</span>
                              <span className="font-mono">{result.tax_regulatory_data.subtotal?.toFixed(2)}</span>
                            </div>
                            <div className="flex justify-between items-center text-sm">
                              <span className="opacity-60">Tax & Surcharges</span>
                              <span className="font-mono">{(result.tax_regulatory_data.tax_amount || 0) + (result.tax_regulatory_data.surcharges || 0)}</span>
                            </div>
                            <div className="h-px bg-white/20" />
                            <div className="flex justify-between items-center">
                              <span className="text-[10px] mono-text font-bold">Grand Total</span>
                              <span className="text-2xl font-bold font-mono">
                                {result.tax_regulatory_data.currency || '$'} {result.tax_regulatory_data.grand_total?.toFixed(2)}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Anomalies / Uncertainties */}
                        <div className="flex-1 space-y-3">
                          <h3 className="text-[10px] mono-text font-bold opacity-40">Data Anomalies</h3>
                          <div className="space-y-2">
                            {result.uncertain_extractions && result.uncertain_extractions.length > 0 ? (
                              result.uncertain_extractions.map((u, idx) => {
                                const score = u.confidence_score;
                                const isHigh = score > 0.7;
                                const isLow = score < 0.4;
                                const colorClass = isHigh ? 'text-emerald-700 bg-emerald-100 border-emerald-200' : 
                                                  isLow ? 'text-red-700 bg-red-100 border-red-200' : 
                                                  'text-amber-700 bg-amber-100 border-amber-200';
                                const barColor = isHigh ? 'bg-emerald-500' : isLow ? 'bg-red-500' : 'bg-amber-500';

                                return (
                                  <div key={idx} className={`border p-4 rounded-sm space-y-3 transition-all hover:shadow-md ${colorClass}`}>
                                    <div className="flex justify-between items-start">
                                      <div className="flex items-center gap-2 font-bold uppercase text-[9px]">
                                        <AlertTriangle size={12} /> {u.field}
                                      </div>
                                      <div className="text-[10px] mono-text font-bold px-2 py-0.5 rounded-full border border-current">
                                        {(score * 100).toFixed(0)}% CONFIDENCE
                                      </div>
                                    </div>
                                    
                                    <p className="text-[11px] leading-relaxed opacity-90">{u.reason}</p>
                                    
                                    <div className="space-y-1.5">
                                      <div className="flex justify-between text-[9px] mono-text opacity-60 uppercase">
                                        <span>Extracted Value: {String(u.value)}</span>
                                        <span>Reliability Index</span>
                                      </div>
                                      <div className="h-1 w-full bg-black/5 rounded-full overflow-hidden">
                                        <motion.div 
                                          initial={{ width: 0 }}
                                          animate={{ width: `${score * 100}%` }}
                                          className={`h-full ${barColor}`}
                                        />
                                      </div>
                                    </div>
                                  </div>
                                );
                              })
                            ) : (
                              <div className="bg-emerald-50 border border-emerald-200 p-4 rounded-sm flex items-center gap-3 text-emerald-800 text-xs">
                                <CheckCircle2 size={16} />
                                No critical anomalies detected in spatial map.
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Raw JSON Toggle */}
                    <div className="pt-8 border-t border-[#141414]/10">
                      <details className="group">
                        <summary className="text-[10px] mono-text font-bold cursor-pointer hover:opacity-100 opacity-40 flex items-center gap-2 list-none">
                          <ChevronRight size={12} className="group-open:rotate-90 transition-transform" />
                          View Raw Machine-Readable Output
                        </summary>
                        <div className="mt-4 bg-[#141414] text-emerald-400 p-6 rounded-sm font-mono text-[10px] overflow-x-auto">
                          <pre>{JSON.stringify(result, null, 2)}</pre>
                        </div>
                      </details>
                    </div>
                  </motion.div>
                )}
              </section>
            </motion.div>
          )}

          {activeTab === 'chat' && (
            <motion.div 
              key="chat"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="flex-1 flex flex-col bg-[#DCDAD7] p-8 overflow-hidden"
            >
              <div className="flex-1 flex flex-col max-w-4xl mx-auto w-full bg-[#E4E3E0] border border-[#141414] rounded-sm shadow-xl overflow-hidden">
                {/* Chat Header */}
                <div className="p-4 border-b border-[#141414] flex justify-between items-center bg-[#141414] text-[#E4E3E0]">
                  <div className="flex items-center gap-3">
                    <Bot size={20} />
                    <div>
                      <h3 className="text-xs font-bold uppercase tracking-widest">Gemini 3.1 Pro Intelligence</h3>
                      <p className="text-[8px] mono-text opacity-60">Advanced Reasoning Engine Active</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <label className="flex items-center gap-2 cursor-pointer group">
                      <span className={`text-[9px] mono-text uppercase transition-colors ${useThinking ? 'text-emerald-400' : 'opacity-40 group-hover:opacity-100'}`}>
                        Thinking Mode
                      </span>
                      <div 
                        onClick={() => setUseThinking(!useThinking)}
                        className={`w-8 h-4 rounded-full relative transition-colors ${useThinking ? 'bg-emerald-500' : 'bg-white/20'}`}
                      >
                        <div className={`absolute top-0.5 w-3 h-3 bg-[#141414] rounded-full transition-all ${useThinking ? 'left-4.5' : 'left-0.5'}`} />
                      </div>
                    </label>
                  </div>
                </div>

                {/* Messages */}
                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                  {chatMessages.length === 0 && (
                    <div className="h-full flex flex-col items-center justify-center text-center opacity-20 space-y-4">
                      <MessageSquare size={48} strokeWidth={1} />
                      <p className="mono-text text-sm">Initiate secure communication channel...</p>
                    </div>
                  )}
                  {chatMessages.map((m, i) => (
                    <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[80%] p-4 rounded-sm space-y-2 ${m.role === 'user' ? 'bg-[#141414] text-[#E4E3E0]' : 'bg-white border border-[#141414]/10'}`}>
                        <div className="flex items-center gap-2 opacity-40 text-[9px] mono-text uppercase">
                          {m.role === 'user' ? <User size={10} /> : <Bot size={10} />}
                          {m.role === 'user' ? 'Operator' : 'Intelligence'}
                          {m.isThinking && <span className="text-emerald-600 font-bold">[THINKING ACTIVE]</span>}
                        </div>
                        <div className="text-xs leading-relaxed markdown-body">
                          <Markdown>{m.text}</Markdown>
                        </div>
                      </div>
                    </div>
                  ))}
                  {isChatLoading && (
                    <div className="flex justify-start">
                      <div className="bg-white border border-[#141414]/10 p-4 rounded-sm flex items-center gap-3">
                        <Loader2 size={16} className="animate-spin opacity-40" />
                        <span className="text-[10px] mono-text opacity-40 uppercase animate-pulse">
                          {useThinking ? 'Deep Reasoning in Progress...' : 'Processing...'}
                        </span>
                      </div>
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </div>

                {/* Chat Input */}
                <form onSubmit={handleChatSubmit} className="p-4 border-t border-[#141414] bg-white flex gap-3">
                  <input 
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder="Enter query for financial intelligence..."
                    className="flex-1 bg-[#F5F5F5] border border-[#141414]/10 rounded-sm px-4 py-3 text-xs focus:outline-none focus:border-[#141414] transition-colors"
                  />
                  <button 
                    type="submit"
                    disabled={isChatLoading || !chatInput.trim()}
                    className="bg-[#141414] text-[#E4E3E0] px-6 rounded-sm hover:bg-[#2a2a2a] transition-colors disabled:opacity-50"
                  >
                    <Send size={18} />
                  </button>
                </form>
              </div>
            </motion.div>
          )}

          {activeTab === 'image-gen' && (
            <motion.div 
              key="image-gen"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.02 }}
              className="flex-1 flex flex-col lg:flex-row bg-[#DCDAD7] p-8 gap-8 overflow-hidden"
            >
              {/* Controls */}
              <section className="w-full lg:w-80 space-y-6">
                <div className="bg-[#E4E3E0] border border-[#141414] p-6 rounded-sm shadow-lg space-y-6">
                  <div className="flex items-center gap-2 text-[#141414]">
                    <Sparkles size={20} />
                    <h3 className="font-bold uppercase tracking-tighter">Visual Studio</h3>
                  </div>

                  <div className="space-y-4">
                    <div className="space-y-2">
                      <label className="text-[10px] mono-text font-bold opacity-40 uppercase">Prompt</label>
                      <textarea 
                        value={imagePrompt}
                        onChange={(e) => setImagePrompt(e.target.value)}
                        placeholder="Describe the financial visualization..."
                        className="w-full h-32 bg-white border border-[#141414]/10 rounded-sm p-3 text-xs focus:outline-none focus:border-[#141414] transition-colors resize-none"
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-[10px] mono-text font-bold opacity-40 uppercase">Aspect Ratio</label>
                      <div className="grid grid-cols-5 gap-1">
                        {['1:1', '3:4', '4:3', '9:16', '16:9'].map(ratio => (
                          <button 
                            key={ratio}
                            onClick={() => setAspectRatio(ratio)}
                            className={`py-2 text-[9px] mono-text border transition-all rounded-sm ${aspectRatio === ratio ? 'bg-[#141414] text-[#E4E3E0] border-[#141414]' : 'bg-white border-[#141414]/10 hover:border-[#141414]/40'}`}
                          >
                            {ratio}
                          </button>
                        ))}
                      </div>
                    </div>

                    <button 
                      onClick={handleImageGen}
                      disabled={isGeneratingImage || !imagePrompt.trim()}
                      className="w-full bg-[#141414] text-[#E4E3E0] py-4 rounded-sm font-bold flex items-center justify-center gap-2 hover:bg-[#2a2a2a] transition-colors disabled:opacity-50 uppercase tracking-widest text-xs"
                    >
                      {isGeneratingImage ? <Loader2 className="animate-spin" size={16} /> : <Zap size={16} />}
                      Generate Asset
                    </button>
                  </div>
                </div>

                <div className="p-4 border border-[#141414]/20 rounded-sm space-y-2">
                  <p className="text-[9px] mono-text font-bold opacity-40 uppercase">Model Specification</p>
                  <p className="text-[10px] leading-relaxed opacity-60">Utilizing Gemini 3 Pro Image Preview for high-fidelity financial conceptualization.</p>
                </div>

                <div className="space-y-3">
                  <p className="text-[9px] mono-text font-bold opacity-40 uppercase">Example Prompts</p>
                  <div className="grid grid-cols-1 gap-2">
                    {EXAMPLE_PROMPTS.map((ex, idx) => (
                      <button 
                        key={idx}
                        onClick={() => setImagePrompt(ex.prompt)}
                        className="text-left p-3 bg-white/50 border border-[#141414]/10 rounded-sm hover:bg-[#141414] hover:text-[#E4E3E0] transition-all group"
                      >
                        <p className="text-[10px] font-bold uppercase tracking-tighter mb-1">{ex.title}</p>
                        <p className="text-[9px] leading-tight opacity-60 group-hover:opacity-100 line-clamp-2">{ex.prompt}</p>
                      </button>
                    ))}
                  </div>
                </div>
              </section>

              {/* Canvas */}
              <section className="flex-1 bg-[#141414] rounded-sm shadow-2xl flex items-center justify-center p-8 overflow-hidden relative">
                <AnimatePresence mode="wait">
                  {isGeneratingImage ? (
                    <motion.div 
                      key="loading"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="flex flex-col items-center gap-4 text-[#E4E3E0]"
                    >
                      <div className="w-12 h-12 border-4 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin" />
                      <p className="mono-text text-sm animate-pulse">Synthesizing Visual Data...</p>
                    </motion.div>
                  ) : generatedImage ? (
                    <motion.div 
                      key="image"
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="h-full w-full flex items-center justify-center"
                    >
                      <img 
                        src={generatedImage} 
                        alt="Generated Visual" 
                        className="max-h-full max-w-full object-contain shadow-2xl rounded-sm"
                        referrerPolicy="no-referrer"
                      />
                      <button 
                        onClick={() => {
                          const link = document.createElement('a');
                          link.href = generatedImage;
                          link.download = `generated_${Date.now()}.png`;
                          link.click();
                        }}
                        className="absolute bottom-6 right-6 bg-white/10 hover:bg-white/20 backdrop-blur-md text-white p-3 rounded-full transition-all"
                      >
                        <Download size={20} />
                      </button>
                    </motion.div>
                  ) : (
                    <motion.div 
                      key="placeholder"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="text-[#E4E3E0]/10 flex flex-col items-center gap-4"
                    >
                      <ImageIcon size={120} strokeWidth={0.5} />
                      <p className="mono-text text-sm">Visual Canvas Idle</p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </section>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Footer */}
      <footer className="border-t border-[#141414] p-3 bg-[#DCDAD7] flex justify-between items-center text-[9px] mono-text opacity-40">
        <p>© 2026 SEMANTIC DOCUMENT RECONSTRUCTION ENGINE</p>
        <div className="flex gap-4">
          <span>LATENCY: 1.2S</span>
          <span>PRECISION: 99.8%</span>
          <span>MODE: HYPER-API READY</span>
        </div>
      </footer>

      {/* Floating Chatbot */}
      <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-4">
        <AnimatePresence>
          {isFloatingChatOpen && (
            <motion.div 
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.95 }}
              className="w-80 h-[450px] bg-[#E4E3E0] border border-[#141414] rounded-sm shadow-2xl flex flex-col overflow-hidden"
            >
              <div className="p-3 bg-[#141414] text-[#E4E3E0] flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <Bot size={16} />
                  <span className="text-[10px] mono-text font-bold uppercase">Quick Intelligence</span>
                </div>
                <button 
                  onClick={() => setIsFloatingChatOpen(false)}
                  className="opacity-60 hover:opacity-100 transition-opacity"
                >
                  <ChevronRight size={16} className="rotate-90" />
                </button>
              </div>
              
              <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-[#DCDAD7]">
                {chatMessages.length === 0 && (
                  <div className="h-full flex flex-col items-center justify-center text-center opacity-20 space-y-2">
                    <MessageSquare size={32} strokeWidth={1} />
                    <p className="text-[9px] mono-text">Awaiting input...</p>
                  </div>
                )}
                {chatMessages.map((m, i) => (
                  <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[90%] p-3 rounded-sm text-[11px] ${m.role === 'user' ? 'bg-[#141414] text-[#E4E3E0]' : 'bg-white border border-[#141414]/10 shadow-sm'}`}>
                      <div className="text-xs leading-relaxed markdown-body">
                        <Markdown>{m.text}</Markdown>
                      </div>
                    </div>
                  </div>
                ))}
                {isChatLoading && (
                  <div className="flex justify-start">
                    <div className="bg-white border border-[#141414]/10 p-2 rounded-sm flex items-center gap-2">
                      <Loader2 size={12} className="animate-spin opacity-40" />
                      <span className="text-[8px] mono-text opacity-40 uppercase animate-pulse">Thinking...</span>
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              <form onSubmit={handleChatSubmit} className="p-3 border-t border-[#141414] bg-white flex gap-2">
                <input 
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="Ask intelligence..."
                  className="flex-1 bg-[#F5F5F5] border border-[#141414]/10 rounded-sm px-3 py-2 text-[10px] focus:outline-none focus:border-[#141414]"
                />
                <button 
                  type="submit"
                  disabled={isChatLoading || !chatInput.trim()}
                  className="bg-[#141414] text-[#E4E3E0] p-2 rounded-sm hover:bg-[#2a2a2a] disabled:opacity-50"
                >
                  <Send size={14} />
                </button>
              </form>
            </motion.div>
          )}
        </AnimatePresence>

        <button 
          onClick={() => setIsFloatingChatOpen(!isFloatingChatOpen)}
          className={`w-14 h-14 rounded-full flex items-center justify-center shadow-2xl transition-all ${isFloatingChatOpen ? 'bg-[#141414] text-[#E4E3E0] rotate-90' : 'bg-[#141414] text-[#E4E3E0] hover:scale-110'}`}
        >
          {isFloatingChatOpen ? <ChevronRight size={24} /> : <Bot size={24} />}
        </button>
      </div>
    </div>
  );
}
