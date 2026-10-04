// Netlify Function entry: wraps the existing Express application so the
// unchanged /api/* routes run serverless. No product logic lives here.
import serverless from 'serverless-http'
import app from '../../server/index.ts'

export const handler = serverless(app)
