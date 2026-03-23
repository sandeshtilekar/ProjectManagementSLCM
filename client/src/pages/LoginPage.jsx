// LoginPage.jsx
import { useState }     from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast             from 'react-hot-toast';
import { useStore }      from '../context/store';

const T = {
  bg:'#0b0d19', surface:'#13162b', border:'#232747',
  accent:'#5b7ffc', text:'#e4e8ff', textMuted:'#7880a8',
};
const inp = {
  width:'100%', background:'#0e1022', border:`1px solid ${T.border}`,
  borderRadius:7, color:T.text, fontSize:14, padding:'11px 14px',
  fontFamily:'inherit', outline:'none', boxSizing:'border-box',
};

export function LoginPage() {
  const [email, setEmail]     = useState('');
  const [pass,  setPass]      = useState('');
  const [loading, setLoading] = useState(false);
  const login    = useStore(s => s.login);
  const navigate = useNavigate();

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await login(email, pass);
      navigate('/');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Login failed');
    } finally { setLoading(false); }
  };

  return (
    <div style={{minHeight:'100vh', background:T.bg, display:'flex',
      alignItems:'center', justifyContent:'center', fontFamily:"'DM Sans',system-ui"}}>
      <div style={{width:380, background:T.surface, borderRadius:14,
        border:`1px solid ${T.border}`, padding:'36px 32px',
        boxShadow:'0 24px 60px rgba(0,0,0,.5)'}}>
        <div style={{textAlign:'center', marginBottom:28}}>
          <div style={{fontSize:32, marginBottom:10}}>⊞</div>
          <h1 style={{color:T.text, fontSize:24, fontWeight:700, margin:0, letterSpacing:'-.5px'}}>GridBase</h1>
          <p style={{color:T.textMuted, fontSize:14, margin:'6px 0 0'}}>Sign in to your account</p>
        </div>
        <form onSubmit={submit} style={{display:'flex', flexDirection:'column', gap:14}}>
          <input style={inp} type="email" placeholder="Email" value={email}
            onChange={e => setEmail(e.target.value)} required />
          <input style={inp} type="password" placeholder="Password" value={pass}
            onChange={e => setPass(e.target.value)} required />
          <button type="submit" disabled={loading}
            style={{padding:'12px', borderRadius:8, border:'none', background:T.accent,
              color:'#fff', fontWeight:600, fontSize:14, cursor:'pointer', fontFamily:'inherit',
              opacity: loading ? .7 : 1}}>
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
        <p style={{color:T.textMuted, fontSize:13, textAlign:'center', marginTop:20}}>
          No account?{' '}
          <Link to="/register" style={{color:T.accent, textDecoration:'none', fontWeight:500}}>Sign up</Link>
        </p>
      </div>
    </div>
  );
}

// RegisterPage.jsx
export function RegisterPage() {
  const [name,    setName]    = useState('');
  const [email,   setEmail]   = useState('');
  const [pass,    setPass]    = useState('');
  const [loading, setLoading] = useState(false);
  const register  = useStore(s => s.register);
  const navigate  = useNavigate();

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await register(email, pass, name);
      navigate('/');
      toast.success('Welcome to GridBase!');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Registration failed');
    } finally { setLoading(false); }
  };

  return (
    <div style={{minHeight:'100vh', background:T.bg, display:'flex',
      alignItems:'center', justifyContent:'center', fontFamily:"'DM Sans',system-ui"}}>
      <div style={{width:380, background:T.surface, borderRadius:14,
        border:`1px solid ${T.border}`, padding:'36px 32px',
        boxShadow:'0 24px 60px rgba(0,0,0,.5)'}}>
        <div style={{textAlign:'center', marginBottom:28}}>
          <div style={{fontSize:32, marginBottom:10}}>⊞</div>
          <h1 style={{color:T.text, fontSize:24, fontWeight:700, margin:0, letterSpacing:'-.5px'}}>Create Account</h1>
          <p style={{color:T.textMuted, fontSize:14, margin:'6px 0 0'}}>Start for free, no credit card needed</p>
        </div>
        <form onSubmit={submit} style={{display:'flex', flexDirection:'column', gap:14}}>
          <input style={inp} type="text" placeholder="Full name" value={name}
            onChange={e => setName(e.target.value)} required />
          <input style={inp} type="email" placeholder="Email" value={email}
            onChange={e => setEmail(e.target.value)} required />
          <input style={inp} type="password" placeholder="Password (min 8 chars)" value={pass}
            onChange={e => setPass(e.target.value)} minLength={8} required />
          <button type="submit" disabled={loading}
            style={{padding:'12px', borderRadius:8, border:'none', background:T.accent,
              color:'#fff', fontWeight:600, fontSize:14, cursor:'pointer', fontFamily:'inherit',
              opacity: loading ? .7 : 1}}>
            {loading ? 'Creating account…' : 'Create Account'}
          </button>
        </form>
        <p style={{color:T.textMuted, fontSize:13, textAlign:'center', marginTop:20}}>
          Already have an account?{' '}
          <Link to="/login" style={{color:T.accent, textDecoration:'none', fontWeight:500}}>Sign in</Link>
        </p>
      </div>
    </div>
  );
}

export default LoginPage;
