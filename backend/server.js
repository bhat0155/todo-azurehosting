const express = require('express')
const cors = require('cors')
const app = express();
app.use(cors())
app.use(express.json());

const todoArray=[];

app.get('/', (req, res)=>{
    res.send("Hello world, this is a sample todo app backend built with express")
})

app.get('/todos', (req, res) => {
    res.status(200).json(todoArray)
})

// get a todo from id
app.get('/todos/:id', (req, res)=>{
    const {id}=req.params;
    const todo = todoArray.find((item)=> item.id === parseInt(id));
    if(todo){
        res.status(200).json(todo)
    }else{
        res.status(404).json({message: 'Todo not found'})
    }
})

app.post('/todos', (req, res)=>{
    const {title}=req.body;
    const newTodo = {id: Date.now(), title, completed: false};
    todoArray.push(newTodo);
    res.status(201).json(newTodo)
})

app.patch('/todos/:id', (req,res)=>{
    const {id}=req.params;
    const todo = todoArray.find((item)=> item.id === parseInt(id));
    if(todo){
        const {completed} = req.body;
        todo.completed = completed;
        res.status(200).json(todo)  
    }else{
        res.status(404).json({message: 'Todo not found'})
    }
})

app.delete('/todos/:id', (req,res)=>{
    const {id}=req.params;
    const index = todoArray.findIndex((item)=> item.id === parseInt(id));
    if(index !== -1){
        todoArray.splice(index, 1);
        res.status(200).json({message: 'Todo deleted successfully'})
    }else{
        res.status(404).json({message: 'Todo not found'})
    }
})

app.listen(3001,()=>{
    console.log('Server is running on port 3001')
})