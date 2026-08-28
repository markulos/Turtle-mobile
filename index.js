// App entry. Telemetry loads FIRST — before the app module graph — so its
// fetch wrapper sits under ServerContext's auth interceptor (which then
// patches over it and hands our flush POST a Bearer token). See
// services/perfTelemetry.js for the whole contract.
import './services/perfTelemetry';
import 'expo/AppEntry';
