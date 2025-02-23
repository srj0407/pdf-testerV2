# Use Python 3.9 on a slim Debian base
FROM python:3.9-slim-buster

# Install native binaries needed by pdf2image and pytesseract
#  - poppler-utils (for converting PDF to images)
#  - tesseract-ocr + libtesseract-dev (for OCR)
RUN apt-get update && apt-get install -y --no-install-recommends \
    poppler-utils \
    tesseract-ocr \
    libtesseract-dev \
 && apt-get clean \
 && rm -rf /var/lib/apt/lists/*

# Set a working directory
WORKDIR /app

# Copy and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application code
COPY . /app

# Expose the port (Vercel will provide $PORT at runtime)
EXPOSE 8080

# For production, we typically use gunicorn
RUN pip install gunicorn

# The "CMD" instruction is what runs when the container starts.
#  - Bind Gunicorn to 0.0.0.0:$PORT so Vercel can route traffic into your container.
#  - "api.pdf_syllabus_parseer:app" references the file path and the Flask `app` variable.
CMD exec gunicorn --bind 0.0.0.0:$PORT api.pdf_syllabus_parseer:app
