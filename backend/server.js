const express = require('express')
const cors = require('cors')
const app = express();
const {PrismaClient}=require('@prisma/client');
const prisma = new PrismaClient()
app.use(cors())
app.use(express.json());



app.get('/', (req, res)=>{
    res.send("Hello world, this is a sample todo app backend built with express")
})

app.get('/todos', async (req, res) => {
    const todos = await prisma.todo.findMany();
    res.status(200).json(todos)
})

// get a todo from id
app.get('/todos/:id', async (req, res)=>{
    const {id}=req.params;
    const todo = await prisma.todo.findUnique({
        where: {
            id: parseInt(id)
        }
    });
    if(todo){
        res.status(200).json(todo)
    }else{
        res.status(404).json({message: 'Todo not found'})
    }
})

app.post('/todos', async (req, res)=>{
    const {title}=req.body;
    const newTodo = await prisma.todo.create({
        data: {
            title,
            completed: false
        }
    });
    res.status(201).json(newTodo)
})

app.patch('/todos/:id', async (req,res)=>{
    const {id}=req.params;
    const todo = await prisma.todo.findUnique({
        where: {
            id: parseInt(id)
        }
    });
    if(todo){
        const {completed} = req.body;
        const updatedTodo = await prisma.todo.update({
            where: {
                id: parseInt(id)
            },
            data: {
                completed
            }
        });
        res.status(200).json(updatedTodo)  
    }else{
        res.status(404).json({message: 'Todo not found'})
    }
})

app.delete('/todos/:id', async (req,res)=>{
    const {id}=req.params;
    const todo = await prisma.todo.findUnique({
        where: {
            id: parseInt(id)
        }
    });
    if(todo){
        await prisma.todo.delete({
            where: {
                id: parseInt(id)
            }
        });
        res.status(200).json({message: 'Todo deleted successfully'})
    }else{
        res.status(404).json({message: 'Todo not found'})
    }
})

app.listen(3001,()=>{
    console.log('Server is running on port 3001')
})