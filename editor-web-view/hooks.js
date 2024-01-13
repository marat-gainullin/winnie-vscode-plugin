(function () {
    const VsCode = acquireVsCodeApi()
    window.Winnie.alert = (text) => {
        VsCode.postMessage({ type: 'alert', content: text });
    }

    window.Winnie.layout.properties.showOddRowsInOtherColor = false;
    window.Winnie.layout.tOpen.visible = false;
    window.Winnie.layout.tSave.toolTipText = 'Save';
    window.Winnie.layout.tSave.visible = false;
    window.Winnie.layout.tExport.visible = false;
    window.Winnie.layout.tUndo.visible = false;
    window.Winnie.layout.tRedo.visible = false;
    /*
    window.Winnie.layout.tCut.visible = false;
    window.Winnie.layout.tCopy.visible = false;
    window.Winnie.layout.tPaste.visible = false;
    window.Winnie.layout.tRemove.visible = false;
    */

    window.Winnie.save = () => { }
    const winnieEdit = window.Winnie.edit
    window.Winnie.edit = (body, parentUR) => {
        winnieEdit.call(window.Winnie, body, parentUR)
        if (parentUR == null) {
            VsCode.postMessage({ type: 'edit-happend', label: body.name });
        }
    }

    window.onmessage = function (evt) {
        var message = evt.data
        switch (message.type) {
            case 'content-init':
            case 'content-changed':
                try {
                    window.Winnie.parseOpenJsonFromTs(message.content)
                } catch (e) {
                    if (!!e.message) {
                        window.Winnie.alert(e.message)
                    } else {
                        window.Winnie.alert(e)
                    }
                }
                break;
            case 'content-generate':
                try {
                    var content = message.ts ? window.Winnie.exportAsTs() : window.Winnie.exportAsEs6()
                    VsCode.postMessage({ type: 'content-generated', content: content });
                } catch (e) {
                    VsCode.postMessage({ type: 'content-not-generated', content: !!e.message ? e.message : 'error' });
                }
                break;
            case 'undo':
                window.Winnie.undo()
                break;
            case 'redo':
                window.Winnie.redo()
                break;
        }
    }
    VsCode.postMessage({ type: 'ready', content: '' });
})();