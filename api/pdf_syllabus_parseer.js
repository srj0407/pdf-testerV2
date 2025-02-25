// api/pdf_syllabus_parser.js
import express from "express";
import multer from "multer";
import fs from "fs/promises";
import path from "path";
import pdfParse from "pdf-parse";
import { fromPath } from "pdf2pic";
import Tesseract from "tesseract.js";

// Set up Express and multer for handling file uploads.
const app = express();
const upload = multer({ dest: "tmp/" });

// --- Helper Functions ---

/**
 * Extracts text from a PDF using pdf-parse.
 * @param {string} pdfPath - Path to the PDF file.
 * @returns {Promise<string>} - The extracted text.
 */
async function extractTextFromPDF(pdfPath) {
  try {
    const dataBuffer = await fs.readFile(pdfPath);
    const data = await pdfParse(dataBuffer);
    return data.text;
  } catch (err) {
    console.error(`Error reading PDF file '${pdfPath}':`, err);
    throw err;
  }
}

/**
 * Converts PDF pages to images and uses OCR (tesseract.js) to extract text.
 * @param {string} pdfPath - Path to the PDF file.
 * @returns {Promise<string>} - The OCR-extracted text.
 */
async function extractTextWithOCR(pdfPath) {
  try {
    // Set options for pdf2pic. Adjust density/size as needed.
    const options = {
      density: 400,
      saveFilename: "page",
      savePath: "./tmp",
      format: "png",
      width: 1200,
      height: 1600,
    };
    const converter = fromPath(pdfPath, options);

    // First, get the number of pages using pdfParse.
    const dataBuffer = await fs.readFile(pdfPath);
    const parsed = await pdfParse(dataBuffer);
    const numPages = parsed.numpages;

    let ocrText = "";
    for (let i = 1; i <= numPages; i++) {
      // Convert page i to an image.
      const conversionResult = await converter(i);
      // Use Tesseract to recognize text from the image.
      const { data: { text } } = await Tesseract.recognize(conversionResult.path, "eng", {
        logger: m => console.log(m)
      });
      ocrText += text + "\n";
      // Optionally, delete the image file after processing.
      await fs.unlink(conversionResult.path);
    }
    return ocrText;
  } catch (err) {
    console.error(`Error during OCR processing of PDF file '${pdfPath}':`, err);
    throw err;
  }
}

/**
 * Extracts a section of text from a larger text block using a heading.
 * @param {string} text - The complete text.
 * @param {string} sectionHeading - The heading marking the start of the section.
 * @returns {string|null} - The extracted section, or null if not found.
 */
function extractSection(text, sectionHeading) {
  const pattern = new RegExp(`${sectionHeading}\\s*[:\\n]+\\s*(.*?)(?=\\n[A-Z][a-z]|$)`, "i");
  const match = text.match(pattern);
  return match ? match[1].trim() : null;
}

/**
 * Extracts a section using a start heading and one of the specified end boundaries.
 * @param {string} text - The complete text.
 * @param {string} startHeading - The heading marking the beginning of the section.
 * @param {string[]} endBoundaries - An array of strings indicating section end boundaries.
 * @returns {string|null} - The extracted section, or null if not found.
 */
function extractSectionWithBoundaries(text, startHeading, endBoundaries) {
  const boundaryPattern = endBoundaries.map(b => `\\n${b}`).join("|");
  const pattern = new RegExp(`${startHeading}\\s*[:\\n]+\\s*(.*?)(?=${boundaryPattern}|$)`, "i");
  const match = text.match(pattern);
  return match ? match[1].trim() : null;
}

/**
 * Iterates over possible headings and returns the section text from the first match.
 * @param {string} text - The complete text.
 * @param {string[]} possibleHeadings - An array of candidate headings.
 * @returns {string|null} - The extracted section, or null.
 */
function extractSectionMultiple(text, possibleHeadings) {
  for (const heading of possibleHeadings) {
    const sectionText = extractSection(text, heading);
    if (sectionText) return sectionText;
  }
  return null;
}

/**
 * Filters text lines that mention "late" or "penalty".
 * @param {string} text - The text to filter.
 * @returns {string} - Filtered lines joined by newlines.
 */
function filterLatePolicy(text) {
  const lines = text.split("\n");
  const filtered = lines.filter(line =>
    line.toLowerCase().includes("late") || line.toLowerCase().includes("penalty")
  );
  return filtered.join("\n");
}

// --- Express Route ---

/**
 * POST /extract
 * Endpoint to extract sections from an uploaded PDF.
 * Expects a multipart/form-data upload with a file field.
 */
app.post("/extract", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file provided." });
    }
    if (!req.file.originalname) {
      return res.status(400).json({ error: "No file selected." });
    }
    
    const filePath = req.file.path; // temporary path from multer

    // Attempt to extract text using pdf-parse.
    let pdfText = await extractTextFromPDF(filePath);
    // If the extracted text is empty or looks like a raw PDF, use OCR.
    if (!pdfText.trim() || pdfText.trim().startsWith("%PDF")) {
      pdfText = await extractTextWithOCR(filePath);
    }

    // Define sections to extract along with candidate headings and boundaries.
    const sections = {
      "Late Policy": {
        headings: ["Homework:"],
        filter: "late_policy"
      },
      "Grading Policy": {
        headings: ["Grading Scale:", "Grading Scale"],
        boundaries: ["Attendance", "Course Policies"]
      },
      "Grading Weights": {
        headings: ["Grade Evaluation:", "Grade Evaluation", "Graded Work:", "Graded Work"],
        boundaries: ["Grading Scale"]
      }
    };

    const extractedData = {};
    for (const [section, params] of Object.entries(sections)) {
      const headings = params.headings || [];
      const boundaries = params.boundaries || null;
      let sectionText = null;
      if (boundaries) {
        for (const heading of headings) {
          sectionText = extractSectionWithBoundaries(pdfText, heading, boundaries);
          if (sectionText) break;
        }
        if (!sectionText) {
          sectionText = extractSectionMultiple(pdfText, headings);
        }
      } else {
        sectionText = extractSectionMultiple(pdfText, headings);
      }

      if (section === "Late Policy" && sectionText) {
        sectionText = filterLatePolicy(sectionText);
      }
      extractedData[section] = sectionText;
    }

    // Clean up: remove the temporary file.
    await fs.unlink(filePath);
    return res.json(extractedData);
  } catch (err) {
    console.error("Error processing PDF:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

// Export the app (or use app.listen if running locally).
export default app;

// For local testing, uncomment the following lines:
// const PORT = process.env.PORT || 3000;
// app.listen(PORT, () => {
//   console.log(`Server is running on port ${PORT}`);
// });
