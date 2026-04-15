import { useMemo, useRef, useState } from 'react'
import Tesseract from 'tesseract.js'

type VehicleData = {
  vin: string
  make: string
  model: string
  year: string
  bodyClass: string
  vehicleType: string
  engineCylinders: string
  displacementL: string
  fuelType: string
  driveType: string
  plantCountry: string
  plantCity: string
  manufacturer: string
}

const VIN_REGEX = /\b(?!.*[IOQ])[A-HJ-NPR-Z0-9]{17}\b/g

function normalizeOcrText(text: string) {
  return text
    .toUpperCase()
    .replace(/[^A-Z0-9\n\r ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractVinCandidates(text: string) {
  const normalized = normalizeOcrText(text).replace(/O/g, '0').replace(/I/g, '1').replace(/Q/g, '0')
  const directMatches = normalized.match(VIN_REGEX) || []
  const compact = normalized.replace(/\s+/g, '')
  const windowed: string[] = []

  for (let i = 0; i <= compact.length - 17; i += 1) {
    const slice = compact.slice(i, i + 17)
    if (/^[A-HJ-NPR-Z0-9]{17}$/.test(slice)) {
      windowed.push(slice)
    }
  }

  return Array.from(new Set([...directMatches, ...windowed]))
}

function validateVin(vin: string) {
  if (vin.length !== 17) return { ok: false, reason: 'VIN must be exactly 17 characters.' }
  if (/[IOQ]/.test(vin)) return { ok: false, reason: 'VIN cannot contain I, O, or Q.' }
  return { ok: true, reason: 'VIN format looks valid.' }
}

async function decodeVin(vin: string): Promise<VehicleData> {
  const response = await fetch(`https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVin/${vin}?format=json`)
  if (!response.ok) throw new Error('Decode request failed')

  const data = await response.json()
  const results = Array.isArray(data?.Results) ? data.Results : []
  const getValue = (label: string) => results.find((item: any) => item.Variable === label)?.Value || ''

  return {
    vin,
    make: getValue('Make'),
    model: getValue('Model'),
    year: getValue('Model Year'),
    bodyClass: getValue('Body Class'),
    vehicleType: getValue('Vehicle Type'),
    engineCylinders: getValue('Engine Number of Cylinders'),
    displacementL: getValue('Displacement (L)'),
    fuelType: getValue('Fuel Type - Primary'),
    driveType: getValue('Drive Type'),
    plantCountry: getValue('Plant Country'),
    plantCity: getValue('Plant City'),
    manufacturer: getValue('Manufacturer Name'),
  }
}

export default function App() {
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const [ocrText, setOcrText] = useState('')
  const [vinCandidates, setVinCandidates] = useState<string[]>([])
  const [selectedVin, setSelectedVin] = useState('')
  const [progress, setProgress] = useState('')
  const [loading, setLoading] = useState(false)
  const [decodeLoading, setDecodeLoading] = useState(false)
  const [error, setError] = useState('')
  const [decodeError, setDecodeError] = useState('')
  const [vehicleData, setVehicleData] = useState<VehicleData | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const validation = useMemo(() => (selectedVin ? validateVin(selectedVin.trim().toUpperCase()) : null), [selectedVin])

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const nextFile = event.target.files?.[0] || null
    setError('')
    setDecodeError('')
    setVehicleData(null)
    setOcrText('')
    setVinCandidates([])
    setSelectedVin('')

    if (!nextFile) {
      setFile(null)
      setPreviewUrl('')
      return
    }

    if (!nextFile.type.startsWith('image/')) {
      setError('Please upload an image file.')
      return
    }

    setFile(nextFile)
    setPreviewUrl(URL.createObjectURL(nextFile))
  }

  const handleRecognize = async () => {
    if (!file) {
      setError('Please upload a VIN image first.')
      return
    }

    try {
      setLoading(true)
      setError('')
      setDecodeError('')
      setVehicleData(null)
      setProgress('Reading text from image...')

      const result = await Tesseract.recognize(file, 'eng', {
        logger: (info) => {
          if (info.status) {
            const pct = typeof info.progress === 'number' ? ` ${Math.round(info.progress * 100)}%` : ''
            setProgress(`${info.status}${pct}`)
          }
        },
      })

      const text = result.data.text || ''
      setOcrText(text)
      const candidates = extractVinCandidates(text)
      setVinCandidates(candidates)
      setSelectedVin(candidates[0] || '')

      if (!candidates.length) {
        setError('No VIN was found. Try a clearer, closer image or correct it manually.')
      }
    } catch {
      setError('OCR failed while processing the image.')
    } finally {
      setLoading(false)
      setProgress('')
    }
  }

  const handleDecode = async () => {
    const vin = selectedVin.trim().toUpperCase()
    const vinCheck = validateVin(vin)

    if (!vinCheck.ok) {
      setDecodeError(vinCheck.reason)
      setVehicleData(null)
      return
    }

    try {
      setDecodeLoading(true)
      setDecodeError('')
      const data = await decodeVin(vin)
      setVehicleData(data)
    } catch {
      setDecodeError('VIN decode failed. Check the VIN and try again.')
      setVehicleData(null)
    } finally {
      setDecodeLoading(false)
    }
  }

  const copyVin = async () => {
    if (!selectedVin) return
    await navigator.clipboard.writeText(selectedVin)
  }

  const resetAll = () => {
    setFile(null)
    setPreviewUrl('')
    setOcrText('')
    setVinCandidates([])
    setSelectedVin('')
    setProgress('')
    setLoading(false)
    setDecodeLoading(false)
    setError('')
    setDecodeError('')
    setVehicleData(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const fields = vehicleData
    ? [
        ['Make', vehicleData.make],
        ['Model', vehicleData.model],
        ['Year', vehicleData.year],
        ['Vehicle Type', vehicleData.vehicleType],
        ['Body Class', vehicleData.bodyClass],
        ['Drive Type', vehicleData.driveType],
        ['Fuel Type', vehicleData.fuelType],
        ['Engine', [vehicleData.engineCylinders, vehicleData.displacementL ? `${vehicleData.displacementL}L` : ''].filter(Boolean).join(' / ')],
        ['Manufacturer', vehicleData.manufacturer],
        ['Plant', [vehicleData.plantCountry, vehicleData.plantCity].filter(Boolean).join(', ')],
      ]
    : []

  return (
    <div className="page">
      <div className="container">
        <header className="hero card">
          <div>
            <span className="badge">Stage 1 + Stage 2</span>
            <h1>VIN OCR & Decoder</h1>
            <p>Upload a VIN photo, extract the 17-character code, and decode basic vehicle data.</p>
          </div>
        </header>

        <div className="grid two">
          <section className="card">
            <h2>1. Upload image</h2>
            <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileChange} />
            <div className="actions">
              <button onClick={handleRecognize} disabled={!file || loading}>{loading ? 'Working...' : 'Recognize VIN'}</button>
              <button className="secondary" onClick={handleDecode} disabled={!selectedVin || decodeLoading}>{decodeLoading ? 'Decoding...' : 'Decode VIN'}</button>
              <button className="ghost" onClick={resetAll}>Reset</button>
            </div>
            <p className="hint">Best results come from clear close-up photos of the dashboard label, door sticker, or stamped metal VIN plate.</p>
            {progress ? <div className="notice">{progress}</div> : null}
            {error ? <div className="error">{error}</div> : null}
          </section>

          <section className="card">
            <h2>2. Preview</h2>
            {previewUrl ? <img className="preview" src={previewUrl} alt="VIN preview" /> : <div className="placeholder">Image preview will appear here</div>}
          </section>
        </div>

        <div className="grid two">
          <section className="card">
            <h2>3. OCR text</h2>
            <pre className="output">{ocrText || 'Recognized text will appear here.'}</pre>
          </section>

          <section className="card">
            <h2>4. VIN result</h2>
            <label className="label">Selected VIN</label>
            <div className="inline">
              <input value={selectedVin} onChange={(e) => setSelectedVin(e.target.value.toUpperCase())} placeholder="Example: 5UXKR0C54E0H22781" />
              <button className="secondary" onClick={copyVin} disabled={!selectedVin}>Copy</button>
            </div>

            {validation ? <div className={validation.ok ? 'success' : 'error'}>{validation.reason}</div> : null}
            {decodeError ? <div className="error">{decodeError}</div> : null}

            <div className="chips">
              {vinCandidates.length ? vinCandidates.map((vin) => (
                <button key={vin} className={vin === selectedVin ? 'chip active' : 'chip'} onClick={() => setSelectedVin(vin)}>{vin}</button>
              )) : <span className="hint">VIN candidates will appear here.</span>}
            </div>
          </section>
        </div>

        <section className="card">
          <h2>5. Decoded vehicle data</h2>
          {vehicleData ? (
            <div className="data-grid">
              {fields.map(([label, value]) => (
                <div key={label} className="data-item">
                  <div className="data-label">{label}</div>
                  <div className="data-value">{value || '—'}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="placeholder small">Decoded vehicle details will appear here after VIN decode.</div>
          )}
        </section>
      </div>
    </div>
  )
}
