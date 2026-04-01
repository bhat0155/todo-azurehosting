import { useState, useEffect } from 'react'
import { getTodos, createTodo, toggleTodo, deleteTodo } from './api'

function App() {
  const [todos, setTodos] = useState([]);
  const [input, setInput] = useState('');

  useEffect(() => {
    const fetchTodos = async () => {
      const data = await getTodos();
      setTodos(data)
    }
    fetchTodos();
  }, [])

  async function handleSave() {
    if (input.trim() === '') return;
    const newTodo = await createTodo(input);
    setTodos([...todos, newTodo])
    setInput('');
  }

  async function changeTodo(id, completed) {
    const updatedTodo = await toggleTodo(id, !completed);
    setTodos(todos.map((item) => item.id === id ? updatedTodo : item))
  }

  async function remove(id) {
    await deleteTodo(id);
    setTodos(todos.filter((item) => item.id !== id))
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') handleSave();
  }

  const completed = todos.filter(t => t.completed).length;
  const progress = todos.length === 0 ? 0 : (completed / todos.length) * 100;

  return (
    <div className="app">
      <header className="app-header">
        <p className="eyebrow">Personal Workspace</p>
        <h1>Ekam's Todos</h1>
        <p className="subtitle">Stay focused. Get things done.</p>
      </header>

      <div className="input-area">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Add a new task..."
        />
        <button className="add-btn" onClick={handleSave}>+ Add</button>
      </div>

      {todos.length > 0 && (
        <div className="stats-bar">
          <p className="count">
            <span>{completed}</span> of {todos.length} completed
          </p>
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}

      <div className="todo-list">
        {todos.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">✦</div>
            <p>No tasks yet. Add one above.</p>
          </div>
        ) : (
          todos.map((item) => (
            <div key={item.id} className={`todo-item ${item.completed ? 'completed' : ''}`}>
              <div className="checkbox-wrapper">
                <input
                  type="checkbox"
                  id={`todo-${item.id}`}
                  checked={item.completed}
                  onChange={() => changeTodo(item.id, item.completed)}
                />
                <label htmlFor={`todo-${item.id}`} />
              </div>
              <span className="todo-title">{item.title}</span>
              <button className="delete-btn" onClick={() => remove(item.id)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6l-1 14H6L5 6" />
                  <path d="M10 11v6M14 11v6" />
                  <path d="M9 6V4h6v2" />
                </svg>
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export default App